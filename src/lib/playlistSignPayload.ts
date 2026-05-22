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

const NOTE_FIELDS: readonly string[] = ['text', 'duration']

const REPRO_FIELDS: readonly string[] = ['engineVersion', 'seed', 'assetsSHA256', 'frameHash']

const PROVENANCE_FIELDS: readonly string[] = ['type', 'contract', 'dependencies']

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

/** Recursively whitelist a DisplayPrefs object. */
function canonicalDisplayPrefs(d: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(d)) return undefined
  const out = pickFields(d, DISPLAY_PREFS_FIELDS)
  if (isPlainObject(out.interaction)) {
    out.interaction = pickFields(out.interaction, INTERACTION_FIELDS)
  }
  return out
}

/** Recursively whitelist a PlaylistItem. */
function canonicalPlaylistItem(item: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(item)) return undefined
  const out = pickFields(item, PLAYLIST_ITEM_FIELDS)
  if ('display' in out) out.display = canonicalDisplayPrefs(out.display)
  if (isPlainObject(out.note)) out.note = pickFields(out.note, NOTE_FIELDS)
  if (isPlainObject(out.repro)) out.repro = pickFields(out.repro, REPRO_FIELDS)
  if (isPlainObject(out.provenance)) {
    const prov = pickFields(out.provenance, PROVENANCE_FIELDS)
    if (isPlainObject(prov.contract)) {
      prov.contract = pickFields(prov.contract, PROVENANCE_CONTRACT_FIELDS)
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

  return out
}
