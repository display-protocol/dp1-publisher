/**
 * Map ff-indexer-v2 token rows to DP-1 playlist items for series expand at publish.
 * Source URLs come from display only; tokens without a renderable URL are skipped.
 */

import { v4 as uuidv4 } from 'uuid'
import type { IndexerToken } from '@/lib/indexerApi'
import type { PlaylistItem, ProvenanceBlock } from '@/types/dp1'

type ProvenanceChain = NonNullable<ProvenanceBlock['contract']>['chain']
type ProvenanceStandard = NonNullable<ProvenanceBlock['contract']>['standard']

const KNOWN_STANDARDS: ProvenanceStandard[] = ['erc721', 'erc1155', 'fa2']

/** Normalize indexer chain strings to DP-1 provenance contract.chain. */
export function normalizeIndexerChain(chain: string): ProvenanceChain {
  const lower = chain.trim().toLowerCase()
  if (lower === 'tezos') return 'tezos'
  if (lower === 'bitmark') return 'bitmark'
  return 'evm'
}

/** Normalize indexer standard to DP-1 provenance contract.standard. */
export function normalizeIndexerStandard(standard: string): ProvenanceStandard {
  const lower = standard.trim().toLowerCase()
  if ((KNOWN_STANDARDS as string[]).includes(lower)) {
    return lower as ProvenanceStandard
  }
  return 'other'
}

/** display.animation_url → display.image_url; null when display is missing or empty. */
export function resolveTokenSourceUrl(token: IndexerToken): string | null {
  const display = token.display
  if (!display) return null
  const animation = display.animation_url?.trim()
  if (animation) return animation
  const image = display.image_url?.trim()
  if (image) return image
  return null
}

/**
 * Build one playlist leaf from an indexer token.
 * Returns null when no renderable display URL is available.
 */
export function indexerTokenToPlaylistItem(token: IndexerToken): PlaylistItem | null {
  const source = resolveTokenSourceUrl(token)
  if (!source) return null

  const item: PlaylistItem = {
    id: uuidv4(),
    source,
    provenance: {
      type: 'onChain',
      contract: {
        chain: normalizeIndexerChain(token.chain),
        standard: normalizeIndexerStandard(token.standard),
        address: token.contract_address,
        tokenId: token.token_number,
      },
    },
  }

  const name = token.metadata?.name?.trim()
  if (name) {
    item.title = name
  }

  return item
}

/** Map tokens to playlist items; returns items and skip count for curator warnings. */
export function indexerTokensToPlaylistItems(tokens: IndexerToken[]): {
  items: PlaylistItem[]
  skippedCount: number
} {
  const items: PlaylistItem[] = []
  let skippedCount = 0
  for (const token of tokens) {
    const item = indexerTokenToPlaylistItem(token)
    if (item) {
      items.push(item)
    } else {
      skippedCount += 1
    }
  }
  return { items, skippedCount }
}
