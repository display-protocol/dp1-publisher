/**
 * Parse + describe layer for the review-and-sign page (`#/sign`).
 *
 * The page accepts an already-composed DP-1 document (built by ff-cli, an
 * agent, or another tool), so unlike the forms it must first work out *what*
 * it was handed before it can validate it. This module owns that pipeline:
 *
 *   text → detect kind → strict per-kind validation → import normalization →
 *   plain-language summary for the signer
 *
 * Validation and normalization deliberately mirror the JSON-tab paths in
 * PlaylistForm / ChannelForm / PlaylistGroupForm (`parse*Json` +
 * `*FromJsonImport`) so a document that publishes from a form's JSON tab
 * parses identically here. HTTP, wallet, and preparePublish stay out of this
 * module — the page component orchestrates those, same as the forms do.
 */

import { v4 as uuidv4 } from 'uuid'
import { validatePlaylistURI } from '@/lib/api'
import type { Channel, Entity, Playlist, PlaylistGroup, PlaylistItem } from '@/types/dp1'

export type ReviewedDp1Document =
  | { kind: 'playlist'; document: Playlist }
  | { kind: 'playlist-group'; document: PlaylistGroup }
  | { kind: 'channel'; document: Channel }

export type ReviewParseResult = { doc: ReviewedDp1Document } | { error: string }

export type ReviewSigningRole = 'curator' | 'publisher'

/**
 * Everything the review pane renders. Field text is written for the signer,
 * not the developer: the point of the page (issue #10) is that the signature
 * ceremony carries trust weight the composition UI never surfaces — so the
 * summary must say in plain language what is being attested and what can
 * legitimately change underneath the signature afterwards.
 */
export interface ReviewSummary {
  kindLabel: string
  title: string
  /** id / slug provenance line (monospace-ish detail row). */
  identity: string[]
  /** Concrete facts about the document contents. */
  facts: string[]
  /** What the wallet signature attests to. */
  covers: string[]
  /** What can change after signing without this wallet's re-consent. */
  canChangeAfter: string[]
  role: ReviewSigningRole
}

// ----------------------------------------------------------------------------
// Detection
// ----------------------------------------------------------------------------

/**
 * Kind detection is structural:
 * - `items[]` → playlist (only playlists carry items)
 * - `playlists[]` + any channel marker (`version` / `publisher` / `curators`)
 *   → channel
 * - `playlists[]` otherwise → playlist group (a channel authored without
 *   version, publisher, or curators is degenerate; the group reading is the
 *   safer default and validation gives a clear error either way)
 * - both or neither → explicit error, never a guess
 */
function detectKind(
  o: Record<string, unknown>
): 'playlist' | 'playlist-group' | 'channel' | { error: string } {
  const hasItems = Array.isArray(o.items)
  const hasPlaylists = Array.isArray(o.playlists)
  if (hasItems && hasPlaylists) {
    return {
      error:
        'Document has both "items" and "playlists" — cannot tell if it is a playlist or a channel. Remove one.',
    }
  }
  if (hasItems) return 'playlist'
  if (!hasPlaylists) {
    return {
      error:
        'Not a recognizable DP-1 document: expected "items" (playlist) or "playlists" (channel / playlist group).',
    }
  }
  if ('version' in o || 'publisher' in o || 'curators' in o) return 'channel'
  return 'playlist-group'
}

// ----------------------------------------------------------------------------
// Strict validation (mirrors the forms' JSON-tab parsers)
// ----------------------------------------------------------------------------

function validatePlaylistShape(
  o: Record<string, unknown>,
  extensionsEnabled: boolean
): string | null {
  const title = typeof o.title === 'string' ? o.title.trim() : ''
  if (!title) return 'Title is required.'
  const items = o.items as unknown[]
  if (items.length === 0) {
    if (!extensionsEnabled) return 'At least one item with a source URI is required.'
    if (!o.dynamicQuery)
      return 'At least one item with a source URI is required, or provide dynamicQuery.'
  } else {
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (!it || typeof it !== 'object') return `items[${i}] must be an object.`
      const src =
        typeof (it as PlaylistItem).source === 'string'
          ? (it as PlaylistItem).source.trim()
          : ''
      if (!src) return `items[${i}].source is required.`
      const validation = validatePlaylistURI(src)
      if (!validation.valid) return `items[${i}].source: ${validation.reason || 'Invalid URI'}`
    }
  }
  if (!extensionsEnabled && o.dynamicQuery != null && typeof o.dynamicQuery === 'object') {
    return 'dynamicQuery requires DP-1 extensions (disabled for this publisher).'
  }
  return null
}

function validateUriListShape(o: Record<string, unknown>): string | null {
  const title = typeof o.title === 'string' ? o.title.trim() : ''
  if (!title) return 'Title is required.'
  const uris = o.playlists as unknown[]
  if (uris.length === 0) return 'At least one playlist URI is required.'
  for (let i = 0; i < uris.length; i++) {
    const u = uris[i]
    if (typeof u !== 'string' || !u.trim())
      return `playlists[${i}] must be a non-empty URI string.`
    const validation = validatePlaylistURI(u.trim())
    if (!validation.valid) return `playlists[${i}]: ${validation.reason || 'Invalid URI'}`
  }
  return null
}

// ----------------------------------------------------------------------------
// Import normalization (mirrors the forms' *FromJsonImport helpers)
// ----------------------------------------------------------------------------

/** Strip prior signatures, default id/created, trim source/playlist URIs. */
function stripSignatures<T extends object>(raw: T): Omit<T, 'signatures' | 'signature'> {
  const { signatures: _s, signature: _legacy, ...rest } = raw as T & {
    signatures?: unknown
    signature?: unknown
  }
  return rest
}

function defaultedCreated(created: unknown): string {
  return typeof created === 'string' && created.trim() !== ''
    ? created
    : new Date().toISOString()
}

function normalizePlaylist(raw: Playlist): Playlist {
  const rest = stripSignatures(raw)
  return {
    ...rest,
    id: rest.id || uuidv4(),
    created: defaultedCreated(rest.created),
    items: rest.items.map((item) => ({
      ...item,
      id: item.id || uuidv4(),
      source: typeof item.source === 'string' ? item.source.trim() : item.source,
    })),
  }
}

function normalizeUriList<T extends Channel | PlaylistGroup>(raw: T): T {
  const rest = stripSignatures(raw) as T
  return {
    ...rest,
    id: rest.id || uuidv4(),
    created: defaultedCreated(rest.created),
    playlists: (rest.playlists ?? [])
      .map((u) => (typeof u === 'string' ? u.trim() : String(u)))
      .filter(Boolean),
  }
}

// ----------------------------------------------------------------------------
// Entry point
// ----------------------------------------------------------------------------

export function parseReviewDocument(
  text: string,
  opts: { extensionsEnabled: boolean }
): ReviewParseResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { error: 'Not valid JSON.' }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { error: 'Document must be a JSON object.' }
  }
  const o = data as Record<string, unknown>
  const kind = detectKind(o)
  if (typeof kind === 'object') return kind

  if (kind === 'playlist') {
    const invalid = validatePlaylistShape(o, opts.extensionsEnabled)
    if (invalid) return { error: invalid }
    return { doc: { kind, document: normalizePlaylist(data as Playlist) } }
  }
  if (kind === 'channel') {
    if (!opts.extensionsEnabled) {
      return {
        error:
          'This looks like a channel, but DP-1 extensions are off for this feed deployment — channels cannot be published here.',
      }
    }
    const invalid = validateUriListShape(o)
    if (invalid) return { error: invalid }
    return { doc: { kind, document: normalizeUriList(data as Channel) } }
  }
  const invalid = validateUriListShape(o)
  if (invalid) return { error: invalid }
  return { doc: { kind, document: normalizeUriList(data as PlaylistGroup) } }
}

// ----------------------------------------------------------------------------
// Plain-language summary
// ----------------------------------------------------------------------------

function shortDid(key: string): string {
  return key.length > 28 ? `${key.slice(0, 24)}…${key.slice(-4)}` : key
}

function entityLine(e: Entity): string {
  const name = e.name?.trim()
  return name ? `${name} (${shortDid(e.key)})` : shortDid(e.key)
}

/** Unique hosts of a URI list, for "where the content lives" facts. */
function uniqueHosts(uris: string[]): string[] {
  const hosts = new Set<string>()
  for (const u of uris) {
    try {
      const parsed = new URL(u)
      hosts.add(parsed.protocol === 'ipfs:' ? 'ipfs://' : parsed.host)
    } catch {
      // Unparseable URIs already failed validation upstream; skip defensively.
    }
  }
  return [...hosts]
}

function identityLines(doc: { id?: string; slug?: string }): string[] {
  const lines: string[] = []
  if (doc.id) lines.push(`id: ${doc.id}`)
  if (doc.slug?.trim()) lines.push(`slug: ${doc.slug.trim()}`)
  return lines
}

export function describeReviewDocument(reviewed: ReviewedDp1Document): ReviewSummary {
  if (reviewed.kind === 'playlist') {
    const p = reviewed.document
    const sources = p.items.map((i) => i.source).filter(Boolean)
    const facts: string[] = [
      p.items.length === 1 ? '1 artwork / item' : `${p.items.length} artworks / items`,
    ]
    const hosts = uniqueHosts(sources)
    if (hosts.length > 0) facts.push(`Content is served from: ${hosts.join(', ')}`)
    if (p.dynamicQuery) {
      facts.push(
        `Dynamic playlist: items are loaded live from ${p.dynamicQuery.endpoint} — what plays can differ from what is listed here.`
      )
    }
    if (p.curators?.length) {
      facts.push(`Declared curators: ${p.curators.map(entityLine).join('; ')}`)
    }
    return {
      kindLabel: 'Playlist',
      title: p.title,
      identity: identityLines(p),
      facts,
      covers: [
        'Your signature (role: curator) attests to exactly this list of items and their display settings.',
        'The published playlist will name your connected wallet as a curator.',
      ],
      canChangeAfter: [
        'Only this same wallet (or the feed operator) can replace this playlist later, by signing an update.',
        'Channels that link this playlist show updates automatically — channel publishers do not re-approve your changes.',
      ],
      role: 'curator',
    }
  }

  if (reviewed.kind === 'channel') {
    const ch = reviewed.document
    const facts: string[] = [
      ch.playlists.length === 1 ? '1 linked playlist' : `${ch.playlists.length} linked playlists`,
    ]
    const hosts = uniqueHosts(ch.playlists)
    if (hosts.length > 0) facts.push(`Playlist links point at: ${hosts.join(', ')}`)
    if (ch.publisher) facts.push(`Declared publisher: ${entityLine(ch.publisher)}`)
    if (ch.curators?.length) {
      facts.push(`Declared curators: ${ch.curators.map(entityLine).join('; ')}`)
    }
    return {
      kindLabel: 'Channel',
      title: ch.title,
      identity: identityLines(ch),
      facts,
      covers: [
        'Your signature (role: publisher) attests to the channel itself: its title and its list of playlist links.',
        'It does NOT cover the artwork behind those links — you are endorsing the list, not freezing its contents.',
        'The published channel will name your connected wallet as the publisher.',
      ],
      canChangeAfter: [
        'The linked playlists stay editable by their own curators — their contents can change without your re-approval, and your signature stays valid when that happens.',
        'The channel document itself (title, which playlists are linked) can only be changed by this wallet or the feed operator.',
      ],
      role: 'publisher',
    }
  }

  const g = reviewed.document
  const facts: string[] = [
    g.playlists.length === 1 ? '1 linked playlist' : `${g.playlists.length} linked playlists`,
  ]
  const hosts = uniqueHosts(g.playlists)
  if (hosts.length > 0) facts.push(`Playlist links point at: ${hosts.join(', ')}`)
  if (g.curator?.trim()) facts.push(`Declared curator: ${shortDid(g.curator.trim())}`)
  return {
    kindLabel: 'Playlist group',
    title: g.title,
    identity: identityLines(g),
    facts,
    covers: [
      'Your signature (role: curator) attests to the group itself: its title and its list of playlist links.',
      'It does NOT cover the artwork behind those links.',
      'The published group will name your connected wallet as the curator.',
    ],
    canChangeAfter: [
      'The linked playlists stay editable by their own curators — their contents can change without your re-approval.',
      'The group document itself can only be changed by this wallet or the feed operator.',
    ],
    role: 'curator',
  }
}

/**
 * hasUnnamedWalletEntity reports whether the prepared document carries the
 * signing wallet as a curator/publisher entity with an empty display name.
 *
 * Spec-legal (Entity `name` may be empty — display-protocol/dp1#42) but
 * usually unintended when a human is at the sign page: the attribution field
 * exists precisely to fill this slot, and it is easy to skip — two documents
 * shipped with blank names on 2026-08-02 before anyone noticed. The sign
 * page uses this to show a non-blocking hint next to the attribution input;
 * it must never block signing, because an unnamed identity is valid.
 */
export function hasUnnamedWalletEntity(doc: ReviewedDp1Document, walletDID: string): boolean {
  const entities: Array<Entity | undefined> = []
  if (doc.kind === 'channel') {
    entities.push(doc.document.publisher, ...(doc.document.curators ?? []))
  } else if (doc.kind === 'playlist') {
    entities.push(...(doc.document.curators ?? []))
  }
  // playlist-group carries only the legacy string `curator` — no Entity
  // objects to be unnamed.
  return entities.some((e) => e != null && e.key === walletDID && !(e.name ?? '').trim())
}
