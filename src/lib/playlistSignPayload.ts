/**
 * Build the JSON object the feed hashes for playlist (curator) signatures.
 * Aligns with https://github.com/display-protocol/dp1-feed-v2 `buildPlaylistDocument` + `json.Marshal(playlist.Playlist)`:
 * - identity.Entity: omit empty `url` ([entityWire])
 * - `summary` / `coverImage`: omit when empty (struct tags `omitempty`)
 * - `curators`: omit when length 0 (server only sets `p.Curators` when `len(req.Curators) > 0`)
 * - **only the typed playlist fields are emitted**: unknown top-level keys
 *   from imported JSON are dropped here so they can't survive in signed
 *   bytes and break feed-side signature verification. The feed reconstructs
 *   a typed struct via `json.Marshal(playlist.Playlist)`, which omits any
 *   unknown fields — so we must match that shape pre-hash.
 */

import { entityWire } from '@/lib/dp1EntityWire'
import { stripSignatureFields } from '@/lib/signing'
import type { Entity, Playlist } from '@/types/dp1'

/**
 * Whitelist of top-level keys the feed's typed Playlist struct emits during
 * `json.Marshal`. Anything outside this list — `_buildMeta`, tool metadata,
 * etc. — is dropped before hashing. Mirrors `src/types/dp1.ts` `Playlist`
 * plus the playlists-extension v0.1 fields the feed accepts.
 */
const PLAYLIST_WIRE_FIELDS: readonly string[] = [
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

/**
 * Plain object to pass to signDocument() for playlists (no top-level signatures).
 */
export function playlistUnsignedPayloadForSigning(p: Playlist): Record<string, unknown> {
  const stripped = stripSignatureFields(p as object) as Record<string, unknown>
  const stable = JSON.parse(JSON.stringify(stripped)) as Record<string, unknown>

  // Whitelist: only typed fields survive into the canonical signing bytes.
  const out: Record<string, unknown> = {}
  for (const key of PLAYLIST_WIRE_FIELDS) {
    if (key in stable) out[key] = stable[key]
  }

  if (Array.isArray(out.curators) && (out.curators as unknown[]).length > 0) {
    out.curators = (out.curators as Entity[]).map((c) => entityWire(c))
  } else {
    delete out.curators
  }

  for (const key of ['summary', 'coverImage'] as const) {
    const v = out[key]
    if (typeof v === 'string' && v.trim() === '') {
      delete out[key]
    }
  }

  return out
}
