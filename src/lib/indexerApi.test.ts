import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  fetchJobStatus,
  fetchTokensByVendorSlug,
  IndexerAPIError,
  MINT_NUMBERS_BATCH_SIZE,
  MintSpecParseError,
  parseMintSpec,
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

  it('throws MintSpecParseError for an explicit list that exceeds MINT_SPEC_MAX_SIZE', () => {
    // Explicit comma-separated lists must be capped identically to ranges so that
    // large pastes cannot fan-out into hundreds of GraphQL calls/mutations.
    const overLimit = Array.from({ length: 1001 }, (_, i) => i + 1).join(',')
    expect(() => parseMintSpec(overLimit)).toThrow(MintSpecParseError)
  })

  it('accepts an explicit list exactly at MINT_SPEC_MAX_SIZE', () => {
    const atLimit = Array.from({ length: 1000 }, (_, i) => i + 1).join(',')
    const result = parseMintSpec(atLimit)
    expect(result).toHaveLength(1000)
  })

  it('throws MintSpecParseError for duplicate comma values', () => {
    expect(() => parseMintSpec('1,2,2')).toThrow(MintSpecParseError)
  })

  it('throws MintSpecParseError for malformed range with extra dots', () => {
    expect(() => parseMintSpec('1..2..3')).toThrow(MintSpecParseError)
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

  it('sends vendor and vendor_release_slug in the request body', async () => {
    const fetchMock = mockFetch({ data: { releases: { items: [] } } })
    vi.stubGlobal('fetch', fetchMock)

    await resolveReleaseBySlug('artblocks', 'fidenza-by-tyler-hobbs')

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.variables).toMatchObject({ vendor: 'artblocks', slug: 'fidenza-by-tyler-hobbs' })
    // Guard: must not fall back to the legacy vendor_release_id field name.
    expect(body.variables).not.toHaveProperty('vendorReleaseId')
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

  it('sends release_vendor_slug and mint_numbers in the request body', async () => {
    const spec = [5, 10, 15]
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { tokens: { items: [], offset: null } } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await fetchTokensByVendorSlug('artblocks', 'fidenza-by-tyler-hobbs', spec)

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    // Guard: slug field names must match the indexer GraphQL schema exactly.
    expect(body.variables).toMatchObject({
      vendor: 'artblocks',
      slug: 'fidenza-by-tyler-hobbs',
      mintNumbers: [5, 10, 15],
    })
    // Guard: must not use old release_id or mint_from/mint_to fields.
    expect(body.variables).not.toHaveProperty('releaseId')
    expect(body.variables).not.toHaveProperty('mintFrom')
    expect(body.variables).not.toHaveProperty('mintTo')
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

  it('sends vendor_release_slug and mint_numbers in the mutation body', async () => {
    const fetchMock = mockFetch({ data: { triggerReleaseIndexing: { job_id: 99 } } })
    vi.stubGlobal('fetch', fetchMock)

    await triggerReleaseIndexing('fxhash', 'geometry-runners', [3, 7, 11])

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.variables).toMatchObject({
      vendor: 'fxhash',
      slug: 'geometry-runners',
      mintNumbers: [3, 7, 11],
    })
    // Guard: must not use the old mint_from/mint_to API.
    expect(body.variables).not.toHaveProperty('mintFrom')
    expect(body.variables).not.toHaveProperty('mintTo')
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

  it('sends job_id as a variable in the query body', async () => {
    const fetchMock = mockFetch({ data: { jobStatus: null } })
    vi.stubGlobal('fetch', fetchMock)

    await fetchJobStatus(42)

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    // Guard: variable name must be jobId (Int!) matching the schema argument job_id.
    expect(body.variables).toMatchObject({ jobId: 42 })
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
