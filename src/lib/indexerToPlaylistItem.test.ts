import { describe, it, expect } from 'vitest'
import {
  indexerTokenToPlaylistItem,
  indexerTokensToPlaylistItems,
  normalizeIndexerChain,
  normalizeIndexerStandard,
  resolveTokenSourceUrl,
} from '@/lib/indexerToPlaylistItem'
import type { IndexerToken } from '@/lib/indexerApi'

function makeToken(overrides: Partial<IndexerToken> = {}): IndexerToken {
  return {
    id: 1,
    chain: 'ethereum',
    standard: 'erc721',
    contract_address: '0xabc',
    token_number: '42',
    release_id: 99,
    mint_number: 1,
    display: {
      animation_url: 'https://example.com/a.mp4',
      image_url: 'https://example.com/a.png',
    },
    metadata: { name: 'Token One' },
    ...overrides,
  }
}

describe('resolveTokenSourceUrl', () => {
  it('prefers animation_url over image_url', () => {
    expect(resolveTokenSourceUrl(makeToken())).toBe('https://example.com/a.mp4')
  })

  it('falls back to image_url when animation is empty', () => {
    expect(
      resolveTokenSourceUrl(
        makeToken({
          display: { animation_url: null, image_url: 'https://example.com/img.png' },
        })
      )
    ).toBe('https://example.com/img.png')
  })

  it('returns null when display is missing', () => {
    expect(resolveTokenSourceUrl(makeToken({ display: null }))).toBeNull()
  })

  it('returns null when both URLs are empty', () => {
    expect(
      resolveTokenSourceUrl(
        makeToken({ display: { animation_url: null, image_url: null } })
      )
    ).toBeNull()
  })
})

describe('normalizeIndexerChain', () => {
  it('maps tezos and bitmark explicitly', () => {
    expect(normalizeIndexerChain('tezos')).toBe('tezos')
    expect(normalizeIndexerChain('bitmark')).toBe('bitmark')
  })

  it('maps other chains to evm', () => {
    expect(normalizeIndexerChain('ethereum')).toBe('evm')
    expect(normalizeIndexerChain('polygon')).toBe('evm')
  })
})

describe('normalizeIndexerStandard', () => {
  it('passes through known standards', () => {
    expect(normalizeIndexerStandard('erc721')).toBe('erc721')
    expect(normalizeIndexerStandard('ERC1155')).toBe('erc1155')
    expect(normalizeIndexerStandard('fa2')).toBe('fa2')
  })

  it('maps unknown standards to other', () => {
    expect(normalizeIndexerStandard('unknown')).toBe('other')
  })
})

describe('indexerTokenToPlaylistItem', () => {
  it('builds item with source, title, and provenance without seriesId', () => {
    const item = indexerTokenToPlaylistItem(makeToken())
    expect(item).not.toBeNull()
    expect(item!.source).toBe('https://example.com/a.mp4')
    expect(item!.title).toBe('Token One')
    expect(item!.id).toBeTruthy()
    expect(item!.provenance).toEqual({
      type: 'onChain',
      contract: {
        chain: 'evm',
        standard: 'erc721',
        address: '0xabc',
        tokenId: '42',
      },
    })
    expect(item!.provenance?.contract).not.toHaveProperty('seriesId')
  })

  it('omits title when metadata name is absent', () => {
    const item = indexerTokenToPlaylistItem(makeToken({ metadata: { name: null } }))
    expect(item!.title).toBeUndefined()
  })

  it('returns null when no display URL', () => {
    expect(
      indexerTokenToPlaylistItem(makeToken({ display: null }))
    ).toBeNull()
  })
})

describe('indexerTokensToPlaylistItems', () => {
  it('counts skipped tokens without renderable URLs', () => {
    const { items, skippedCount } = indexerTokensToPlaylistItems([
      makeToken(),
      makeToken({ id: 2, display: null }),
    ])
    expect(items).toHaveLength(1)
    expect(skippedCount).toBe(1)
  })
})
