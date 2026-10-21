/**
 * Map vendor tokens to DP-1 playlist items for series expand at compose time.
 * Tokens the vendor has taken down, or that expose no renderable media, are
 * skipped and counted so the curator sees why fewer items were added.
 */

import { v4 as uuidv4 } from 'uuid'
import type { VendorToken } from '@/lib/vendors/types'
import type { PlaylistItem } from '@/types/dp1'

export function vendorTokenToPlaylistItem(token: VendorToken): PlaylistItem | null {
  if (token.excluded) return null
  if (!token.source) return null

  const item: PlaylistItem = {
    id: uuidv4(),
    source: token.source,
    provenance: {
      type: 'onChain',
      contract: {
        chain: token.chain,
        standard: token.standard,
        address: token.contractAddress,
        tokenId: token.tokenId,
      },
    },
  }
  if (token.title) item.title = token.title
  return item
}

export interface VendorTokensToItemsResult {
  items: PlaylistItem[]
  /** Tokens that produced no item, for any reason (includes moderatedCount). */
  skippedCount: number
  /** Subset of skippedCount that the vendor has taken down. */
  moderatedCount: number
}

export function vendorTokensToPlaylistItems(tokens: VendorToken[]): VendorTokensToItemsResult {
  const items: PlaylistItem[] = []
  let skippedCount = 0
  let moderatedCount = 0
  for (const token of tokens) {
    const item = vendorTokenToPlaylistItem(token)
    if (item) {
      items.push(item)
      continue
    }
    skippedCount += 1
    if (token.excluded === 'moderated') moderatedCount += 1
  }
  return { items, skippedCount, moderatedCount }
}
