import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildArtBlocksVendorReleaseId,
  fetchReleaseTokens,
  IndexerAPIError,
  resolveRelease,
} from '@/lib/indexerApi'

describe('buildArtBlocksVendorReleaseId', () => {
  it('lowercases contract address to match indexer storage', () => {
    expect(
      buildArtBlocksVendorReleaseId('0xBC4c0E659423DB6217a1A0aF0Acb7D3dD9eEc1', '42')
    ).toBe('1-0xbc4c0e659423db6217a1a0af0acb7d3dd9eec1-42')
  })

  it('trims contract and project id', () => {
    expect(buildArtBlocksVendorReleaseId('  0xabc  ', '  7  ')).toBe('1-0xabc-7')
  })
})

// Helper: build a minimal mock fetch response.
function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  })
}

describe('resolveRelease', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', undefined)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the first release item on success', async () => {
    const release = {
      id: 1,
      vendor: 'feralfile',
      vendor_release_id: 'series-uuid',
      name: 'My Series',
      total_mints: 10,
    }
    vi.stubGlobal(
      'fetch',
      mockFetch({ data: { releases: { items: [release] } } })
    )

    const result = await resolveRelease('feralfile', 'series-uuid')
    expect(result).toEqual(release)
  })

  it('returns null when releases.items is empty (release not found)', async () => {
    vi.stubGlobal('fetch', mockFetch({ data: { releases: { items: [] } } }))

    const result = await resolveRelease('feralfile', 'unknown-id')
    expect(result).toBeNull()
  })

  it('throws IndexerAPIError with status on HTTP failure', async () => {
    vi.stubGlobal('fetch', mockFetch({}, false, 503))

    await expect(resolveRelease('feralfile', 'x')).rejects.toSatisfy(
      (e: unknown) => e instanceof IndexerAPIError && (e as IndexerAPIError).status === 503
    )
  })

  it('throws IndexerAPIError from GraphQL errors array', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ errors: [{ message: 'field not found' }, { message: 'bad input' }] })
    )

    await expect(resolveRelease('feralfile', 'x')).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof IndexerAPIError && (e as IndexerAPIError).message === 'field not found; bad input'
    )
  })

  it('throws IndexerAPIError when response has no data field', async () => {
    vi.stubGlobal('fetch', mockFetch({}))

    await expect(resolveRelease('feralfile', 'x')).rejects.toBeInstanceOf(IndexerAPIError)
  })
})

describe('fetchReleaseTokens', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', undefined)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns token items on success', async () => {
    const token = {
      id: 7,
      chain: 'ethereum',
      standard: 'erc721',
      contract_address: '0xabc',
      token_number: '1',
      release_id: 42,
      mint_number: 1,
      display: { animation_url: 'https://example.com/a.mp4', image_url: null },
      metadata: { name: 'Token 1' },
    }
    vi.stubGlobal('fetch', mockFetch({ data: { tokens: { items: [token] } } }))

    const result = await fetchReleaseTokens(42)
    expect(result).toEqual([token])
  })

  it('returns empty array when no tokens exist for the release', async () => {
    vi.stubGlobal('fetch', mockFetch({ data: { tokens: { items: [] } } }))

    const result = await fetchReleaseTokens(99)
    expect(result).toHaveLength(0)
  })

  it('throws IndexerAPIError on HTTP failure', async () => {
    vi.stubGlobal('fetch', mockFetch({}, false, 500))

    await expect(fetchReleaseTokens(1)).rejects.toBeInstanceOf(IndexerAPIError)
  })
})
