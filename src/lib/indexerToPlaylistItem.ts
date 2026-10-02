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

// ff-indexer-v2 reports `chain` as a CAIP-2 id (`<namespace>:<reference>`,
// e.g. "eip155:1", "tezos:mainnet"). DP-1 provenance only records the chain
// family, so we map by namespace and drop the network reference. The eip155
// namespace is EVM-only by definition, so every eip155 network is "evm".
// "bitmark" is assumed to follow the same CAIP-2 shape; unrecognized
// namespaces (or non-CAIP strings) fall back to "other" so provenance is never
// silently mislabeled.
const CAIP2_NAMESPACE_TO_CHAIN: Record<string, ProvenanceChain> = {
  eip155: 'evm',
  tezos: 'tezos',
  bitmark: 'bitmark',
}

/** Normalize an indexer CAIP-2 chain id to DP-1 provenance contract.chain. */
export function normalizeIndexerChain(chain: string): ProvenanceChain {
  const [namespace, reference] = chain.trim().toLowerCase().split(':', 2)
  if (!namespace || !reference) return 'other'
  return CAIP2_NAMESPACE_TO_CHAIN[namespace] ?? 'other'
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
 *
 * Returns null when:
 * - the token is burned (permanently removed from circulation), or
 * - the token is not yet viewable (still being indexed / suppressed by the
 *   indexer's viewability rules), or
 * - no renderable display URL is available.
 *
 * Burned and non-viewable tokens are fetched with include_unviewable: true
 * so they count as "indexed" for gap detection and Phase 2 polling, but they
 * must not appear in the curator's playlist.
 */
export function indexerTokenToPlaylistItem(token: IndexerToken): PlaylistItem | null {
  if (token.burned || !token.viewable) return null
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
