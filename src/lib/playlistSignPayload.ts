/**
 * Build the JSON object the feed hashes for playlist (curator) signatures.
 * Aligns with https://github.com/display-protocol/dp1-feed-v2 `buildPlaylistDocument` + `json.Marshal(playlist.Playlist)`:
 * - identity.Entity: omit empty `url` ([entityWire])
 * - `summary` / `coverImage`: omit when empty (struct tags `omitempty`)
 * - `curators`: omit when length 0 (server only sets `p.Curators` when `len(req.Curators) > 0`)
 * - **only typed fields are emitted, recursively**: unknown keys at any level —
 *   top-level, inside items, inside item.display, inside defaults,
 *   inside dynamicQuery, etc. — are dropped before hashing. The feed's
 *   typed Go struct silently drops them during `json.Marshal`, so we must
 *   match that shape pre-hash or the signature won't verify.
 */

import { entityWire } from '@/lib/dp1EntityWire'
import { stripSignatureFields } from '@/lib/signing'
import { generateSlug } from '@/lib/utils'
import type { Entity, Playlist } from '@/types/dp1'

// ----------------------------------------------------------------------------
// Whitelists — mirror the typed shapes in `src/types/dp1.ts`. Anything outside
// the named keys is dropped before hashing. `override`, `userOverrides`, and
// dictionary-typed fields like `headers` are *intentional* open shapes and
// are passed through verbatim by being listed (the pickFields helper copies
// values, not their inner keys).
// ----------------------------------------------------------------------------

const PLAYLIST_FIELDS: readonly string[] = [
  // Core
  'dpVersion',
  'id',
  'slug',
  'title',
  'created',
  'defaults',
  'items',
  // playlists-extension v0.1
  'curators',
  'summary',
  'coverImage',
  'dynamicQuery',
  'note',
]

const PLAYLIST_ITEM_FIELDS: readonly string[] = [
  'id',
  'slug',
  'title',
  'source',
  'duration',
  'license',
  'ref',
  'override',
  'display',
  'repro',
  'provenance',
  'note',
  // playlists-extension §3.5.2 (dp1-go v0.5.1 PlaylistItem.DisplayAt,
  // `json:"displayAt,omitempty"`). Absent from this list it was silently
  // stripped before hashing, so published playlists lost their schedule.
  'displayAt',
]

const PLAYLIST_DEFAULTS_FIELDS: readonly string[] = ['display', 'license', 'duration']

const DISPLAY_PREFS_FIELDS: readonly string[] = [
  'scaling',
  'margin',
  'background',
  'autoplay',
  'loop',
  'interaction',
  'userOverrides',
]

const INTERACTION_FIELDS: readonly string[] = ['keyboard', 'mouse']

// `keyboard` is a string array (no keys to filter); `mouse` is a typed struct.
const INTERACTION_MOUSE_FIELDS: readonly string[] = ['click', 'scroll', 'drag', 'hover']

const NOTE_FIELDS: readonly string[] = ['text', 'duration']

// NOTE: `engineVersion` is deliberately NOT whitelisted below — dp1-go's
// ReproBlock.EngineVersion is `map[string]string` (arbitrary engine names),
// an intentional open dictionary like `headers`/`userOverrides`/`override`.
const REPRO_FIELDS: readonly string[] = ['engineVersion', 'seed', 'assetsSHA256', 'frameHash']

const REPRO_FRAME_HASH_FIELDS: readonly string[] = ['sha256', 'phash']

const PROVENANCE_FIELDS: readonly string[] = ['type', 'contract', 'dependencies']

const PROVENANCE_DEPENDENCY_FIELDS: readonly string[] = ['chain', 'standard', 'uri']

const PROVENANCE_CONTRACT_FIELDS: readonly string[] = [
  'chain',
  'standard',
  'address',
  'seriesId',
  'tokenId',
  'uri',
  'metaHash',
]

const DYNAMIC_QUERY_FIELDS: readonly string[] = [
  'profile',
  'endpoint',
  'method',
  'headers',
  'query',
  'responseMapping',
]

const RESPONSE_MAPPING_FIELDS: readonly string[] = ['itemsPath', 'itemSchema', 'itemMap']

/** Copy only whitelisted top-level keys from `obj`. Pass-through values verbatim. */
function pickFields(
  obj: Record<string, unknown>,
  fields: readonly string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of fields) {
    if (k in obj) out[k] = obj[k]
  }
  return out
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Mirror Go `json:",omitempty"` on value-typed struct fields: json.Marshal
 * drops "", false, and empty slices. The feed rebuilds the document from its
 * typed structs before verifying signatures, so a zero value we keep in the
 * hashed bytes would be absent from the feed's re-marshal — a guaranteed
 * signature-verification failure, not just drift.
 *
 * Only safe on structs whose fields are ALL value-typed omitempty in dp1-go
 * (MousePrefs, FrameHash, ProvenanceDep). Pointer-typed fields (e.g.
 * DisplayPrefs.Autoplay `*bool`) survive marshal as explicit false and must
 * NOT go through this.
 */
function dropOmitemptyZeros(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === '' || v === false) continue
    if (Array.isArray(v) && v.length === 0) continue
    out[k] = v
  }
  return out
}

/** Recursively whitelist a DisplayPrefs object. */
function canonicalDisplayPrefs(d: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(d)) return undefined
  const out = pickFields(d, DISPLAY_PREFS_FIELDS)
  if (isPlainObject(out.interaction)) {
    const interaction = pickFields(out.interaction, INTERACTION_FIELDS)
    // Keyboard is `[]string omitempty` — the feed's marshal drops an empty array.
    if (Array.isArray(interaction.keyboard) && interaction.keyboard.length === 0) {
      delete interaction.keyboard
    }
    // MousePrefs bools are value-typed omitempty: false never survives the
    // feed's re-marshal. A present-but-all-false mouse re-marshals as `{}`
    // (the pointer is non-nil), so keep the object itself.
    if (isPlainObject(interaction.mouse)) {
      interaction.mouse = dropOmitemptyZeros(
        pickFields(interaction.mouse, INTERACTION_MOUSE_FIELDS)
      )
    }
    out.interaction = interaction
  }
  return out
}

/** Recursively whitelist a PlaylistItem. */
function canonicalPlaylistItem(item: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(item)) return undefined
  const out = pickFields(item, PLAYLIST_ITEM_FIELDS)
  if ('display' in out) out.display = canonicalDisplayPrefs(out.display)
  if (isPlainObject(out.note)) out.note = pickFields(out.note, NOTE_FIELDS)
  // `DisplayAt *string omitempty` — Go omits only a nil pointer, so JSON null
  // must be dropped pre-hash (the feed's re-marshal drops it; keeping it here
  // would break signature verification). An empty string round-trips verbatim
  // through the pointer, so it is deliberately NOT dropped.
  if (out.displayAt === null) delete out.displayAt
  if (isPlainObject(out.repro)) {
    const repro = pickFields(out.repro, REPRO_FIELDS)
    // engineVersion is an open dictionary (map[string]string) — pass keys
    // verbatim; Go's map omitempty only drops an *empty* map.
    if (
      isPlainObject(repro.engineVersion) &&
      Object.keys(repro.engineVersion).length === 0
    ) {
      delete repro.engineVersion
    }
    if (repro.seed === '') delete repro.seed // `string omitempty`
    if (Array.isArray(repro.assetsSHA256) && repro.assetsSHA256.length === 0) {
      delete repro.assetsSHA256 // `[]string omitempty`
    }
    if (isPlainObject(repro.frameHash)) {
      repro.frameHash = dropOmitemptyZeros(
        pickFields(repro.frameHash, REPRO_FRAME_HASH_FIELDS)
      )
    }
    out.repro = repro
  }
  if (isPlainObject(out.provenance)) {
    const prov = pickFields(out.provenance, PROVENANCE_FIELDS)
    if (isPlainObject(prov.contract)) {
      prov.contract = pickFields(prov.contract, PROVENANCE_CONTRACT_FIELDS)
    }
    if (Array.isArray(prov.dependencies)) {
      // Array elements are typed structs too — filter each one, dropping
      // non-object entries the feed's typed unmarshal could never carry.
      // ProvenanceDep fields are all `string omitempty` → zero-strip each.
      const deps = (prov.dependencies as unknown[])
        .filter(isPlainObject)
        .map((dep) => dropOmitemptyZeros(pickFields(dep, PROVENANCE_DEPENDENCY_FIELDS)))
      // `[]ProvenanceDep omitempty` — the feed drops an empty slice entirely.
      if (deps.length > 0) prov.dependencies = deps
      else delete prov.dependencies
    }
    out.provenance = prov
  }
  return out
}

/**
 * Plain object to pass to signDocument() for playlists (no top-level signatures).
 */
export function playlistUnsignedPayloadForSigning(p: Playlist): Record<string, unknown> {
  const stripped = stripSignatureFields(p as object) as Record<string, unknown>
  const stable = JSON.parse(JSON.stringify(stripped)) as Record<string, unknown>

  // Step 1: whitelist the top level.
  const out = pickFields(stable, PLAYLIST_FIELDS)

  // Step 2: whitelist nested typed structures so unknown fields can't survive
  // through items / defaults / dynamicQuery / note while the feed's typed
  // unmarshal drops them.
  if (Array.isArray(out.items)) {
    out.items = (out.items as unknown[]).map(canonicalPlaylistItem).filter(Boolean)
  }
  if (isPlainObject(out.defaults)) {
    const defaults = pickFields(out.defaults, PLAYLIST_DEFAULTS_FIELDS)
    if ('display' in defaults) defaults.display = canonicalDisplayPrefs(defaults.display)
    out.defaults = defaults
  }
  if (isPlainObject(out.dynamicQuery)) {
    const dq = pickFields(out.dynamicQuery, DYNAMIC_QUERY_FIELDS)
    if (isPlainObject(dq.responseMapping)) {
      dq.responseMapping = pickFields(dq.responseMapping, RESPONSE_MAPPING_FIELDS)
    }
    out.dynamicQuery = dq
  }
  if (isPlainObject(out.note)) out.note = pickFields(out.note, NOTE_FIELDS)

  // Step 3: curators are mapped through entityWire (drops empty url).
  if (Array.isArray(out.curators) && (out.curators as unknown[]).length > 0) {
    out.curators = (out.curators as Entity[]).map((c) => entityWire(c))
  } else {
    delete out.curators
  }

  // Step 4: omitempty on optional blank strings.
  for (const key of ['summary', 'coverImage'] as const) {
    const v = out[key]
    if (typeof v === 'string' && v.trim() === '') {
      delete out[key]
    }
  }

  // Step 5: default the slug, mirroring channelUnsignedPayloadForSigning and
  // playlistGroupUnsignedPayloadForSigning. The composition form runs
  // generateSlug itself, but the review-and-sign paste path does not — without
  // this a pasted playlist would publish with whatever slug (or none) the
  // author happened to include and hit the feed's global slug namespace
  // uncontrolled. generateSlug is idempotent for a document that already
  // carries a slug (it slugifies and returns it), so form-tab and edit-tab
  // documents keep their existing URL.
  const titleForSlug = typeof out.title === 'string' ? out.title : ''
  const idForSlug = typeof out.id === 'string' ? out.id : ''
  const existingSlug = typeof out.slug === 'string' ? out.slug : undefined
  out.slug = generateSlug(titleForSlug, idForSlug, existingSlug)

  return out
}
