import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { expectVendorError } from '@/test/vendorErrors'
import {
  FERALFILE_ARTWORKS_PAGE_SIZE,
  FERALFILE_CDN_PREFIX,
  FERALFILE_MAX_PAGES,
  feralFileArtworkTitle,
  feralFileArtworkToToken,
  feralFileMediaUrl,
  loadFeralFileRelease,
  migrateFeralFileCdn,
  resolveFeralFileSeries,
  type FeralFileArtwork,
} from './feralfile'
import { LOAD_ALL_CAP } from './types'
import { VendorAPIError } from './http'

const SERIES = {
  id: 'series-uuid',
  slug: 'my-series',
  title: 'My Series',
  medium: 'image',
  settings: { maxArtwork: 512 },
}

function artwork(index: number, overrides: Partial<FeralFileArtwork> = {}): FeralFileArtwork {
  return {
    id: `id-${index}`,
    index,
    name: `Work ${index + 1}`,
    chain: 'ethereum',
    contractAddress: '0xd1b52bee57fb7e31ed50122cc1eeb6a4673d9eae',
    tokenID: String(1000 + index),
    previewURI: `previews/series-uuid/${index}.jpg`,
    ...overrides,
  }
}

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) }
}

/**
 * Fetch stub that answers /series with SERIES and /artworks by slicing a
 * synthetic release of `total` artworks according to offset/limit — the same
 * contract the real API has.
 */
function stubApi(total: number, seriesResult: unknown[] = [SERIES]) {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url.includes('/series?')) {
      return Promise.resolve(jsonResponse({ result: seriesResult }))
    }
    const params = new URL(url, 'http://local').searchParams
    const offset = Number(params.get('offset'))
    const limit = Number(params.get('limit'))
    const rows: FeralFileArtwork[] = []
    for (let i = offset; i < Math.min(offset + limit, total); i++) rows.push(artwork(i))
    return Promise.resolve(jsonResponse({ result: rows, paging: { offset, limit, total } }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function artworkCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.includes('/artworks?'))
    .map((url) => {
      const params = new URL(url, 'http://local').searchParams
      return { offset: Number(params.get('offset')), limit: Number(params.get('limit')) }
    })
}

describe('feralFileMediaUrl', () => {
  it('prefixes a relative URI with the artwork CDN', () => {
    expect(feralFileMediaUrl('previews/a/0.jpg')).toBe(`${FERALFILE_CDN_PREFIX}previews/a/0.jpg`)
    expect(feralFileMediaUrl('/previews/a/0.jpg')).toBe(`${FERALFILE_CDN_PREFIX}previews/a/0.jpg`)
  })

  it('rewrites the retired CDN host', () => {
    expect(feralFileMediaUrl('https://cdn.feralfileassets.com/a/b.mp4')).toBe(
      'https://cdn.artworks.feralfile.io/a/b.mp4'
    )
  })

  it('inserts index.html on a directory path, before the query', () => {
    expect(migrateFeralFileCdn('https://cdn.feralfileassets.com/previews/x/?edition_number=1')).toBe(
      'https://cdn.artworks.feralfile.io/previews/x/index.html?edition_number=1'
    )
    expect(feralFileMediaUrl('previews/x/')).toBe(
      'https://cdn.artworks.feralfile.io/previews/x/index.html'
    )
  })

  it('rewrites CDN URLs embedded in query parameters too', () => {
    expect(
      migrateFeralFileCdn(
        'https://cdn.feralfileassets.com/a/index.html?clip=https://cdn.feralfileassets.com/b/'
      )
    ).toBe('https://cdn.artworks.feralfile.io/a/index.html?clip=https://cdn.artworks.feralfile.io/b/')
  })

  it('leaves the bare CDN origin alone', () => {
    expect(migrateFeralFileCdn('https://cdn.artworks.feralfile.io/')).toBe(
      'https://cdn.artworks.feralfile.io/'
    )
  })

  it('appends the xl variant to a Cloudflare Images URL without one', () => {
    expect(feralFileMediaUrl('https://imagedelivery.net/acc/img')).toBe(
      'https://imagedelivery.net/acc/img/xl'
    )
    expect(feralFileMediaUrl('https://imagedelivery.net/acc/img/public')).toBe(
      'https://imagedelivery.net/acc/img/public'
    )
  })

  it('keeps absolute URLs on other hosts and returns null for empty input', () => {
    expect(feralFileMediaUrl('https://other.host/a')).toBe('https://other.host/a')
    expect(feralFileMediaUrl('')).toBeNull()
    expect(feralFileMediaUrl('  ')).toBeNull()
  })
})

describe('feralFileArtworkToToken', () => {
  it('maps an ethereum artwork with a checksummed address and 1-based mint', () => {
    const token = feralFileArtworkToToken(artwork(0))
    expect(token).toMatchObject({
      vendor: 'feralfile',
      mintNumber: 1,
      chain: 'evm',
      standard: 'erc721',
      contractAddress: '0xD1b52beE57FB7e31Ed50122cC1eeb6a4673D9Eae',
      tokenId: '1000',
      title: 'Work 1',
      source: `${FERALFILE_CDN_PREFIX}previews/series-uuid/0.jpg`,
    })
  })

  it('maps a tezos artwork to fa2 without touching the address', () => {
    const token = feralFileArtworkToToken(
      artwork(4, { chain: 'tezos', contractAddress: 'KT1abc', tokenID: '5' })
    )
    expect(token).toMatchObject({ mintNumber: 5, chain: 'tezos', standard: 'fa2', contractAddress: 'KT1abc' })
  })

  it('skips artworks without a mint position or on-chain identity', () => {
    expect(feralFileArtworkToToken(artwork(0, { index: null }))).toBeNull()
    expect(feralFileArtworkToToken(artwork(0, { contractAddress: '' }))).toBeNull()
    expect(feralFileArtworkToToken(artwork(0, { tokenID: '' }))).toBeNull()
    expect(feralFileArtworkToToken(artwork(0, { chain: 'bitmark' }))).toBeNull()
    expect(feralFileArtworkToToken(artwork(0, { contractAddress: 'not-an-address' }))).toBeNull()
  })

  it('yields a null source when the preview is empty', () => {
    expect(feralFileArtworkToToken(artwork(0, { previewURI: '' }))?.source).toBeNull()
  })
})

describe('feralFileArtworkTitle', () => {
  it('prefixes edition-style names with the series title', () => {
    expect(feralFileArtworkTitle('#1', 'Data Pilgrims 01')).toBe('Data Pilgrims 01 #1')
    expect(feralFileArtworkTitle('AP', 'Series')).toBe('Series AP')
    expect(feralFileArtworkTitle('AE', 'Series')).toBe('Series AE')
    expect(feralFileArtworkTitle('PP', 'Series')).toBe('Series PP')
  })

  it('keeps descriptive names as they are', () => {
    expect(feralFileArtworkTitle('MVP 1 Impractical Attempt', 'Most Valuable Painting')).toBe(
      'MVP 1 Impractical Attempt'
    )
  })

  it('keeps an edition name bare when the series title is unknown, and null when empty', () => {
    expect(feralFileArtworkTitle('#1', null)).toBe('#1')
    expect(feralFileArtworkTitle('', 'Series')).toBeNull()
  })
})

describe('resolveFeralFileSeries', () => {
  beforeEach(() => vi.stubGlobal('fetch', undefined))
  afterEach(() => vi.unstubAllGlobals())

  it('queries by encoded slug with limit 1', async () => {
    const fetchMock = stubApi(0)
    await resolveFeralFileSeries('my series')
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/series\?slug=my%20series&limit=1$/)
  })

  it('throws not_found for an unknown slug', async () => {
    stubApi(0, [])
    const err = await expectVendorError(resolveFeralFileSeries('nope'))
    expect(err).toBeInstanceOf(VendorAPIError)
    expect(err.code).toBe('not_found')
  })
})

describe('loadFeralFileRelease — load all', () => {
  beforeEach(() => vi.stubGlobal('fetch', undefined))
  afterEach(() => vi.unstubAllGlobals())

  it('walks pages in index order and stops on a short page', async () => {
    const fetchMock = stubApi(150)
    const result = await loadFeralFileRelease('my-series', null)
    expect(artworkCalls(fetchMock)).toEqual([
      { offset: 0, limit: FERALFILE_ARTWORKS_PAGE_SIZE },
      { offset: 100, limit: FERALFILE_ARTWORKS_PAGE_SIZE },
    ])
    expect(result.tokens).toHaveLength(150)
    expect(result.tokens[0].mintNumber).toBe(1)
    expect(result.tokens[149].mintNumber).toBe(150)
    expect(result.tokens[0].title).toBe('Work 1')
    expect(result.wasCapped).toBe(false)
    expect(result.release).toEqual({
      vendor: 'feralfile',
      slug: 'my-series',
      name: 'My Series',
      totalMints: 512,
    })
  })

  it('stops exactly at LOAD_ALL_CAP and reports wasCapped when the series is larger', async () => {
    const fetchMock = stubApi(1500)
    const result = await loadFeralFileRelease('my-series', null)
    expect(artworkCalls(fetchMock)).toHaveLength(FERALFILE_MAX_PAGES)
    expect(result.tokens).toHaveLength(LOAD_ALL_CAP)
    expect(result.wasCapped).toBe(true)
  })

  it('is not capped when the series ends exactly at the cap', async () => {
    stubApi(LOAD_ALL_CAP)
    const result = await loadFeralFileRelease('my-series', null)
    expect(result.tokens).toHaveLength(LOAD_ALL_CAP)
    expect(result.wasCapped).toBe(false)
  })

  it('falls back to paging.total when the series has no maxArtwork', async () => {
    stubApi(7, [{ ...SERIES, settings: undefined }])
    const result = await loadFeralFileRelease('my-series', null)
    expect(result.release.totalMints).toBe(7)
  })
})

describe('loadFeralFileRelease — mint spec', () => {
  beforeEach(() => vi.stubGlobal('fetch', undefined))
  afterEach(() => vi.unstubAllGlobals())

  it('fetches the covering window from min-1 and keeps only requested mints', async () => {
    const fetchMock = stubApi(10)
    const result = await loadFeralFileRelease('my-series', [3, 5])
    expect(artworkCalls(fetchMock)).toEqual([{ offset: 2, limit: FERALFILE_ARTWORKS_PAGE_SIZE }])
    expect(result.tokens.map((t) => t.mintNumber)).toEqual([3, 5])
    expect(result.wasCapped).toBe(false)
  })

  it('covers a cluster with one page and jumps straight to the next requested mint', async () => {
    const fetchMock = stubApi(1000)
    const result = await loadFeralFileRelease('my-series', [1, 50, 150])
    expect(artworkCalls(fetchMock)).toEqual([
      { offset: 0, limit: FERALFILE_ARTWORKS_PAGE_SIZE },
      { offset: 149, limit: FERALFILE_ARTWORKS_PAGE_SIZE },
    ])
    expect(result.tokens.map((t) => t.mintNumber)).toEqual([1, 50, 150])
    expect(result.uncheckedMints).toEqual([])
  })

  it('loads a sparse spec in one request per cluster', async () => {
    const fetchMock = stubApi(10_000)
    const result = await loadFeralFileRelease('my-series', [1, 5000])
    expect(artworkCalls(fetchMock).map((c) => c.offset)).toEqual([0, 4999])
    expect(result.tokens.map((t) => t.mintNumber)).toEqual([1, 5000])
    expect(result.uncheckedMints).toEqual([])
  })

  it('treats mints past the end of the series as checked and absent', async () => {
    const fetchMock = stubApi(10)
    const result = await loadFeralFileRelease('my-series', [5, 20, 30])
    expect(artworkCalls(fetchMock)).toHaveLength(1)
    expect(result.tokens.map((t) => t.mintNumber)).toEqual([5])
    expect(result.uncheckedMints).toEqual([])
  })

  it('reports mints beyond the page bound as unchecked, not missing', async () => {
    const fetchMock = stubApi(20_000)
    const spec = Array.from({ length: FERALFILE_MAX_PAGES + 2 }, (_, i) => i * 1000 + 1)
    const result = await loadFeralFileRelease('my-series', spec)
    expect(artworkCalls(fetchMock)).toHaveLength(FERALFILE_MAX_PAGES)
    expect(result.tokens).toHaveLength(FERALFILE_MAX_PAGES)
    expect(result.uncheckedMints).toEqual(spec.slice(FERALFILE_MAX_PAGES))
  })
})
