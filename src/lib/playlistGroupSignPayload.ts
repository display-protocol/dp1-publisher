/**
 * Unsigned playlist-group JSON for curator signing.
 * Matches buildPlaylistGroupDocument in https://github.com/display-protocol/dp1-feed-v2 (omitempty curator, summary, coverImage; no signatures).
 */

import { generatePlaylistGroupSlug } from '@/lib/utils'
import type { PlaylistGroup } from '@/types/dp1'

export function playlistGroupUnsignedPayloadForSigning(g: PlaylistGroup): Record<string, unknown> {
  const id = g.id?.trim()
  const created = g.created?.trim()
  if (!id || !created) {
    throw new Error('Playlist group id and created are required for signing')
  }
  const slug = generatePlaylistGroupSlug(g.title, id, g.slug)

  const doc: Record<string, unknown> = {
    id,
    slug,
    title: g.title,
    created,
    playlists: [...g.playlists],
  }

  const curator = g.curator?.trim()
  if (curator) doc.curator = curator
  const summary = g.summary?.trim()
  if (summary) doc.summary = summary
  const coverImage = g.coverImage?.trim()
  if (coverImage) doc.coverImage = coverImage

  return doc
}
