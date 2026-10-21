import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { vendorTokenToPlaylistItem, vendorTokensToPlaylistItems } from '@/lib/vendorTokenToPlaylistItem'
import { validatePlaylistURI } from '@/lib/api'
import type { VendorToken } from '@/lib/vendors/types'

function makeToken(overrides: Partial<VendorToken> = {}): VendorToken {
  return {
    vendor: 'feralfile',
    mintNumber: 1,
    chain: 'evm',
    standard: 'erc721',
    contractAddress: '0xD1b52beE57FB7e31Ed50122cC1eeb6a4673D9Eae',
    tokenId: '42',
    title: 'Work 1',
    source: 'https://cdn.artworks.feralfile.io/previews/a/0.jpg',
    ...overrides,
  }
}

describe('vendorTokenToPlaylistItem', () => {
  it('builds an onChain provenance leaf with a fresh uuid and the title', () => {
    const item = vendorTokenToPlaylistItem(makeToken())
    expect(item).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      source: 'https://cdn.artworks.feralfile.io/previews/a/0.jpg',
      title: 'Work 1',
      provenance: {
        type: 'onChain',
        contract: {
          chain: 'evm',
          standard: 'erc721',
          address: '0xD1b52beE57FB7e31Ed50122cC1eeb6a4673D9Eae',
          tokenId: '42',
        },
      },
    })
    expect(item!.provenance!.contract).not.toHaveProperty('seriesId')
  })

  it('omits the title when the vendor has none', () => {
    expect(vendorTokenToPlaylistItem(makeToken({ title: null }))).not.toHaveProperty('title')
  })

  it('returns null for taken-down tokens and tokens without media', () => {
    expect(vendorTokenToPlaylistItem(makeToken({ excluded: 'moderated' }))).toBeNull()
    expect(vendorTokenToPlaylistItem(makeToken({ source: null }))).toBeNull()
  })
})

describe('vendorTokensToPlaylistItems', () => {
  it('counts skipped and moderated tokens separately', () => {
    const { items, skippedCount, moderatedCount } = vendorTokensToPlaylistItems([
      makeToken({ tokenId: '1' }),
      makeToken({ tokenId: '2', source: null }),
      makeToken({ tokenId: '3', excluded: 'moderated' }),
    ])
    expect(items).toHaveLength(1)
    expect(skippedCount).toBe(2)
    expect(moderatedCount).toBe(1)
  })
})

// URI policy parity — series-derived sources must pass the same validatePlaylistURI
// gate that JSON-tab import enforces, so vendor-expanded items cannot sign/publish
// URLs that the JSON path would reject.
// These tests force production-mode URI policy (DEV=false, no VITE_DEBUG_MODE)
// matching the pattern used in api.test.ts, because the local .env sets VITE_DEBUG_MODE=true.
describe('series-derived sources pass URI policy', () => {
  const originalEnv = { ...import.meta.env }

  beforeEach(() => {
    ;(import.meta.env as { DEV: boolean }).DEV = false
    delete (import.meta.env as Record<string, unknown>).VITE_DEBUG_MODE
  })

  afterEach(() => {
    ;(import.meta.env as { DEV: boolean }).DEV = originalEnv.DEV
    ;(import.meta.env as { VITE_DEBUG_MODE?: string }).VITE_DEBUG_MODE =
      originalEnv.VITE_DEBUG_MODE
  })

  it('accepts https:// vendor media, including gateway-resolved IPFS', () => {
    const cdn = vendorTokenToPlaylistItem(makeToken())
    expect(validatePlaylistURI(cdn!.source)).toMatchObject({ valid: true })
    const ipfs = vendorTokenToPlaylistItem(
      makeToken({
        source:
          'https://ipfs.feralfile.com/ipfs/bafybeicnufmvwbgnqkcivv6k2oequjhfdlm42jkpiwaw5duhkhns2cnava',
      })
    )
    expect(validatePlaylistURI(ipfs!.source)).toMatchObject({ valid: true })
  })

  it('URI policy rejects http:// sources a vendor might return', () => {
    const item = vendorTokenToPlaylistItem(makeToken({ source: 'http://example.com/a.mp4' }))
    expect(item).not.toBeNull()
    // The mapper itself accepts any non-empty URL; the publish gate (validateFormTab)
    // must reject it. Confirm the policy function would catch it.
    expect(validatePlaylistURI(item!.source)).toMatchObject({ valid: false })
  })

  it('URI policy rejects private-IP sources a vendor might return', () => {
    const item = vendorTokenToPlaylistItem(makeToken({ source: 'https://192.168.1.1/a.mp4' }))
    expect(item).not.toBeNull()
    expect(validatePlaylistURI(item!.source)).toMatchObject({ valid: false })
  })
})
