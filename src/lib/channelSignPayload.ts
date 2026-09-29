/**
 * Build the unsigned channel JSON the feed hashes for publisher signatures.
 * The feed verifies over and stores the bytes we send; this mirrors dp1-go's
 * extension/channels Channel struct (omitempty) and the feed's makeSlug so the
 * published shape is the one Go tooling would emit for the same document.
 */

import { entityWire } from '@/lib/dp1EntityWire'
import { generateChannelSlug } from '@/lib/utils'
import type { Channel } from '@/types/dp1'

const DEFAULT_CHANNEL_VERSION = '1.0.0'

/**
 * Plain object to pass to signDocument() for channels (no top-level signatures).
 * Slug is derived with the same rules as makeSlug(..., "channel") in https://github.com/display-protocol/dp1-feed-v2.
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
