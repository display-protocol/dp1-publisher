/**
 * Build the JSON object the feed hashes for playlist (curator) signatures.
 * Aligns with dp1-feed-v2 `buildPlaylistDocument` + `json.Marshal(playlist.Playlist)`:
 * - identity.Entity: omit empty `url` ([entityWire])
 * - `summary` / `coverImage`: omit when empty (struct tags `omitempty`)
 * - `curators`: omit when length 0 (server only sets `p.Curators` when `len(req.Curators) > 0`)
 */

import { entityWire } from '@/lib/dp1EntityWire'
import { stripSignatureFields } from '@/lib/signing'
import type { Entity, Playlist } from '@/types/dp1'

/**
 * Plain object to pass to signDocument() for playlists (no top-level signatures).
 */
export function playlistUnsignedPayloadForSigning(p: Playlist): Record<string, unknown> {
  const stripped = stripSignatureFields(p as object)
  const stable = JSON.parse(JSON.stringify(stripped)) as Record<string, unknown>

  if (Array.isArray(stable.curators) && stable.curators.length > 0) {
    stable.curators = (stable.curators as Entity[]).map((c) => entityWire(c))
  } else {
    delete stable.curators
  }

  for (const key of ['summary', 'coverImage'] as const) {
    const v = stable[key]
    if (typeof v === 'string' && v.trim() === '') {
      delete stable[key]
    }
  }

  return stable
}
