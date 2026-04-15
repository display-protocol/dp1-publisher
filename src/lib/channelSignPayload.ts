/**
 * Build the exact unsigned channel JSON shape the feed hashes for publisher signatures
 * (dp1-go extension/channels Channel struct omitempty + executor buildChannelDocument + makeSlug).
 * Must match server json.Marshal before signatures are attached.
 */

import { entityWire } from '@/lib/dp1EntityWire'
import { generateChannelSlug } from '@/lib/utils'
import type { Channel } from '@/types/dp1'

const DEFAULT_CHANNEL_VERSION = '1.0.0'

/**
 * Plain object to pass to signDocument() for channels (no top-level signatures).
 * Slug is derived with the same rules as dp1-feed-v2 makeSlug(..., "channel").
 */
export function channelUnsignedPayloadForSigning(ch: Channel): Record<string, unknown> {
  const id = ch.id?.trim()
  const created = ch.created?.trim()
  if (!id || !created) {
    throw new Error('Channel id and created are required for signing')
  }
  const version = ch.version?.trim() || DEFAULT_CHANNEL_VERSION
  const slug = generateChannelSlug(ch.title, id, ch.slug)

  const doc: Record<string, unknown> = {
    id,
    slug,
    title: ch.title,
    version,
    created,
    playlists: [...ch.playlists],
  }

  if (ch.curators && ch.curators.length > 0) {
    doc.curators = ch.curators.map(entityWire)
  }
  if (ch.publisher) {
    doc.publisher = entityWire(ch.publisher)
  }
  const summary = ch.summary?.trim()
  if (summary) doc.summary = summary
  const coverImage = ch.coverImage?.trim()
  if (coverImage) doc.coverImage = coverImage

  return doc
}
