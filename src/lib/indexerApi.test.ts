import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildArtBlocksVendorReleaseId,
  fetchJobStatus,
  fetchReleaseTokens,
  fetchTokensByVendorSlug,
  IndexerAPIError,
  MINT_NUMBERS_BATCH_SIZE,
  MintSpecParseError,
  parseMintSpec,
  resolveRelease,
  resolveReleaseBySlug,
  triggerReleaseIndexing,
  triggerReleaseIndexingBatched,
} from '@/lib/indexerApi'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  })
}

// ---------------------------------------------------------------------------
// parseMintSpec
// ---------------------------------------------------------------------------

describe('parseMintSpec', () => {
  it('returns null for empty string', () => {
    expect(parseMintSpec('')).toBeNull()
  })

  it('returns null for whitespace-only string', () => {
    expect(parseMintSpec('  ')).toBeNull()
  })

  it('parses a single number', () => {
    expect(parseMintSpec('50')).toEqual([50])
  })

  it('parses a range into a sorted array', () => {
    expect(parseMintSpec('1..5')).toEqual([1, 2, 3, 4, 5])
  })

  it('parses a range with a single element', () => {
    expect(parseMintSpec('7..7')).toEqual([7])
  })

  it('parses a comma-separated list', () => {
    expect(parseMintSpec('1,3,5')).toEqual([1, 3, 5])
  })

  it('sorts a comma-separated list', () => {
    expect(parseMintSpec('5,1,3')).toEqual([1, 3, 5])
  })

  it('trims whitespace around comma-separated values', () => {
    expect(parseMintSpec(' 2 , 4 ')).toEqual([2, 4])
  })

  it('throws MintSpecParseError for a zero mint number', () => {
    expect(() => parseMintSpec('0')).toThrow(MintSpecParseError)
  })

  it('throws MintSpecParseError for a negative mint number', () => {
    expect(() => parseMintSpec('-1')).toThrow(MintSpecParseError)
  })

  it('throws MintSpecParseError for a reversed range', () => {
    expect(() => parseMintSpec('5..1')).toThrow(MintSpecParseError)
  })

  it('throws MintSpecParseError for a range starting at zero', () => {
    expect(() => parseMintSpec('0..5')).toThrow(MintSpecParseError)
  })

  it('throws MintSpecParseError for non-numeric input', () => {
    expect(() => parseMintSpec('abc')).toThrow(MintSpecParseError)
  })

  it('throws MintSpecParseError for a range that exceeds MINT_SPEC_MAX_SIZE', () => {
    // 1..1001 = 1001 entries, over the 1000 limit
    expect(() => parseMintSpec('1..1001')).toThrow(MintSpecParseError)
  })

  it('accepts a range exactly at MINT_SPEC_MAX_SIZE', () => {
    const result = parseMintSpec('1..1000')
    expect(result).toHaveLength(1000)
    expect(result![0]).toBe(1)
    expect(result![999]).toBe(1000)
  })

  it('throws MintSpecParseError for duplicate comma values', () => {
    expect(() => parseMintSpec('1,2,2')).toThrow(MintSpecParseError)
  })

  it('throws MintSpecParseError for malformed range with extra dots', () => {
    expect(() => parseMintSpec('1..2..3')).toThrow(MintSpecParseError)
  })
})

// ---------------------------------------------------------------------------
// Legacy: buildArtBlocksVendorReleaseId
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// resolveRelease (legacy)
// ---------------------------------------------------------------------------

describe('resolveRelease', () => {
  beforeEach(() => { vi.stubGlobal('fetch', undefined) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('returns the first release item on success', async () => {
    const release = {
      id: 1,
      vendor: 'feralfile',
      vendor_release_id: 'series-uuid',
      vendor_release_slug: null,
      name: 'My Series',
      total_mints: 10,
    }
    vi.stubGlobal('fetch', mockFetch({ data: { releases: { items: [release] } } }))

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

// ---------------------------------------------------------------------------
// resolveReleaseBySlug
// ---------------------------------------------------------------------------

describe('resolveReleaseBySlug', () => {
  beforeEach(() => { vi.stubGlobal('fetch', undefined) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('returns the first release when found by slug', async () => {
    const release = {
      id: 5,
      vendor: 'artblocks',
      vendor_release_id: '1-0xabc-78',
      vendor_release_slug: 'fidenza-by-tyler-hobbs',
      name: 'Fidenza',
      total_mints: 999,
    }
    vi.stubGlobal('fetch', mockFetch({ data: { releases: { items: [release] } } }))

    const result = await resolveReleaseBySlug('artblocks', 'fidenza-by-tyler-hobbs')
    expect(result).toEqual(release)
  })

  it('returns null when no releases match the slug', async () => {
    vi.stubGlobal('fetch', mockFetch({ data: { releases: { items: [] } } }))

    const result = await resolveReleaseBySlug('artblocks', 'unknown-slug')
    expect(result).toBeNull()
  })

  it('throws IndexerAPIError on HTTP failure', async () => {
    vi.stubGlobal('fetch', mockFetch({}, false, 500))

    await expect(resolveReleaseBySlug('feralfile', 'some-slug')).rejects.toBeInstanceOf(IndexerAPIError)
  })
})

// ---------------------------------------------------------------------------
// fetchReleaseTokens (legacy)
// ---------------------------------------------------------------------------

describe('fetchReleaseTokens', () => {
  beforeEach(() => { vi.stubGlobal('fetch', undefined) })
  afterEach(() => { vi.unstubAllGlobals() })

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

// ---------------------------------------------------------------------------
// fetchTokensByVendorSlug
// ---------------------------------------------------------------------------

const makeToken = (id: number, mintNumber: number) => ({
  id,
  chain: 'ethereum',
  standard: 'erc721',
  contract_address: '0xabc',
  token_number: String(mintNumber),
  release_id: 1,
  mint_number: mintNumber,
  display: { animation_url: `https://example.com/${mintNumber}.mp4`, image_url: null },
  metadata: { name: `Token ${mintNumber}` },
})

describe('fetchTokensByVendorSlug — no mint spec (paginated)', () => {
  beforeEach(() => { vi.stubGlobal('fetch', undefined) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('returns all tokens from a single page when offset is null', async () => {
    const tokens = [makeToken(1, 1), makeToken(2, 2)]
    vi.stubGlobal(
      'fetch',
      mockFetch({ data: { tokens: { items: tokens, offset: null } } })
    )

    const result = await fetchTokensByVendorSlug('feralfile', 'my-series')
    expect(result).toEqual(tokens)
  })

  it('paginates when the first response returns a next offset', async () => {
    const page1 = [makeToken(1, 1)]
    const page2 = [makeToken(2, 2)]

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: { tokens: { items: page1, offset: 1 } } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: { tokens: { items: page2, offset: null } } }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchTokensByVendorSlug('feralfile', 'my-series')
    expect(result).toEqual([...page1, ...page2])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('stops paginating when items are empty even if offset is non-null', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ data: { tokens: { items: [], offset: 99 } } })
    )

    const result = await fetchTokensByVendorSlug('feralfile', 'my-series')
    expect(result).toHaveLength(0)
  })

  it('throws IndexerAPIError on HTTP failure', async () => {
    vi.stubGlobal('fetch', mockFetch({}, false, 500))

    await expect(fetchTokensByVendorSlug('artblocks', 'fidenza')).rejects.toBeInstanceOf(IndexerAPIError)
  })
})

describe('fetchTokensByVendorSlug — with mint spec (batched)', () => {
  beforeEach(() => { vi.stubGlobal('fetch', undefined) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('issues a single batch when mintSpec has ≤50 entries', async () => {
    const spec = [1, 2, 3]
    const tokens = spec.map((n) => makeToken(n, n))
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { tokens: { items: tokens, offset: null } } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchTokensByVendorSlug('feralfile', 'my-series', spec)
    expect(result).toEqual(tokens)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('issues two batches when mintSpec exceeds MINT_NUMBERS_BATCH_SIZE', async () => {
    // Build a spec of BATCH_SIZE + 1 entries.
    const spec = Array.from({ length: MINT_NUMBERS_BATCH_SIZE + 1 }, (_, i) => i + 1)
    const batch1Tokens = spec.slice(0, MINT_NUMBERS_BATCH_SIZE).map((n) => makeToken(n, n))
    const batch2Tokens = [makeToken(MINT_NUMBERS_BATCH_SIZE + 1, MINT_NUMBERS_BATCH_SIZE + 1)]

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: { tokens: { items: batch1Tokens, offset: null } } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: { tokens: { items: batch2Tokens, offset: null } } }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchTokensByVendorSlug('feralfile', 'my-series', spec)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toHaveLength(MINT_NUMBERS_BATCH_SIZE + 1)
  })

  it('deduplicates tokens that appear in multiple cross-batch responses', async () => {
    // Use a spec that spans two batches (BATCH_SIZE + 1 items) so we get two requests.
    // Both batches return the same overlapping token (simulates server-side overlap).
    const spec = Array.from({ length: MINT_NUMBERS_BATCH_SIZE + 1 }, (_, i) => i + 1)
    const sharedToken = makeToken(1, 1)

    // Both batch responses include sharedToken; the second batch also has a unique token.
    const uniqueToken = makeToken(MINT_NUMBERS_BATCH_SIZE + 1, MINT_NUMBERS_BATCH_SIZE + 1)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ data: { tokens: { items: [sharedToken], offset: null } } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: { tokens: { items: [sharedToken, uniqueToken], offset: null } },
          }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchTokensByVendorSlug('feralfile', 'my-series', spec)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // sharedToken appears in both batches but should only be in the result once.
    const ids = result.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain(sharedToken.id)
    expect(ids).toContain(uniqueToken.id)
    expect(result).toHaveLength(2)
  })

  it('returns empty array when none of the requested mints are indexed', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ data: { tokens: { items: [], offset: null } } })
    )

    const result = await fetchTokensByVendorSlug('feralfile', 'my-series', [5, 10])
    expect(result).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// triggerReleaseIndexing
// ---------------------------------------------------------------------------

describe('triggerReleaseIndexing', () => {
  beforeEach(() => { vi.stubGlobal('fetch', undefined) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('returns job_id on success', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ data: { triggerReleaseIndexing: { job_id: 42 } } })
    )

    const result = await triggerReleaseIndexing('artblocks', 'fidenza', [1, 2, 3])
    expect(result).toEqual({ job_id: 42 })
  })

  it('throws IndexerAPIError on HTTP failure', async () => {
    vi.stubGlobal('fetch', mockFetch({}, false, 500))

    await expect(triggerReleaseIndexing('artblocks', 'fidenza', [1])).rejects.toBeInstanceOf(
      IndexerAPIError
    )
  })

  it('throws IndexerAPIError from GraphQL errors', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ errors: [{ message: 'invalid vendor' }] })
    )

    await expect(triggerReleaseIndexing('unknown', 'slug', [1])).rejects.toSatisfy(
      (e: unknown) => e instanceof IndexerAPIError && (e as IndexerAPIError).message === 'invalid vendor'
    )
  })
})

// ---------------------------------------------------------------------------
// triggerReleaseIndexingBatched
// ---------------------------------------------------------------------------

describe('triggerReleaseIndexingBatched', () => {
  beforeEach(() => { vi.stubGlobal('fetch', undefined) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('issues a single call and returns one job_id for ≤50 mints', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { triggerReleaseIndexing: { job_id: 10 } } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await triggerReleaseIndexingBatched('feralfile', 'my-series', [1, 2, 3])
    expect(result).toEqual([10])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('issues two calls and returns two job_ids when mints exceed MINT_NUMBERS_BATCH_SIZE', async () => {
    const mints = Array.from({ length: MINT_NUMBERS_BATCH_SIZE + 5 }, (_, i) => i + 1)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: { triggerReleaseIndexing: { job_id: 100 } } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: { triggerReleaseIndexing: { job_id: 101 } } }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const result = await triggerReleaseIndexingBatched('feralfile', 'my-series', mints)
    expect(result).toEqual([100, 101])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('propagates IndexerAPIError from a failed batch', async () => {
    vi.stubGlobal('fetch', mockFetch({}, false, 503))

    await expect(
      triggerReleaseIndexingBatched('fxhash', 'geometry-runners', [1, 2])
    ).rejects.toBeInstanceOf(IndexerAPIError)
  })
})

// ---------------------------------------------------------------------------
// fetchJobStatus
// ---------------------------------------------------------------------------

describe('fetchJobStatus', () => {
  beforeEach(() => { vi.stubGlobal('fetch', undefined) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('returns job status on success', async () => {
    const status = {
      job_id: 99,
      status: 'succeeded',
      last_error: null,
      execution_time_ms: 1500,
    }
    vi.stubGlobal('fetch', mockFetch({ data: { jobStatus: status } }))

    const result = await fetchJobStatus(99)
    expect(result).toEqual(status)
  })

  it('returns null when jobStatus is null (job not found)', async () => {
    vi.stubGlobal('fetch', mockFetch({ data: { jobStatus: null } }))

    const result = await fetchJobStatus(9999)
    expect(result).toBeNull()
  })

  it('throws IndexerAPIError on HTTP failure', async () => {
    vi.stubGlobal('fetch', mockFetch({}, false, 500))

    await expect(fetchJobStatus(1)).rejects.toBeInstanceOf(IndexerAPIError)
  })

  it('throws IndexerAPIError from GraphQL errors', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ errors: [{ message: 'job not accessible' }] })
    )

    await expect(fetchJobStatus(1)).rejects.toSatisfy(
      (e: unknown) => e instanceof IndexerAPIError
    )
  })

  it('surfaces last_error when job has failed', async () => {
    const status = {
      job_id: 7,
      status: 'failed',
      last_error: 'contract ABI mismatch',
      execution_time_ms: null,
    }
    vi.stubGlobal('fetch', mockFetch({ data: { jobStatus: status } }))

    const result = await fetchJobStatus(7)
    expect(result?.status).toBe('failed')
    expect(result?.last_error).toBe('contract ABI mismatch')
  })
})
