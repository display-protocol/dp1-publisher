import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { expectVendorError } from '@/test/vendorErrors'
import {
  OBJKT_GRAPHQL_URL,
  OBJKT_PAGE_SIZE,
  OBJKT_TOKEN_ID_BATCH_SIZE,
  isObjktContract,
  loadObjktRelease,
  objktTokenToToken,
  resolveObjktCollection,
  type ObjktCollection,
  type ObjktTokenRow,
} from './objkt'
import { DEFAULT_IPFS_GATEWAY_BASE_URL } from './ipfs'
import { LOAD_ALL_CAP } from './types'
import { VendorAPIError } from './http'

const KT1 = 'KT1XR4XgBJ2RZz1vW22q6EKdSNgYbmaaWr5z'
const COLLECTION: ObjktCollection = {
  name: 'qubibi: hello world',
  editions: 4500,
  items: 45,
  collection_type: 'custom',
}

function row(tokenId: string, overrides: Partial<ObjktTokenRow> = {}): ObjktTokenRow {
  return {
    token_id: tokenId,
    name: `Echoes #${tokenId}`,
    artifact_uri: `ipfs://artifact-${tokenId}`,
    display_uri: `ipfs://display-${tokenId}`,
    mime: 'image/png',
    flag: 'none',
    ...overrides,
  }
}

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) }
}

/**
 * objkt stub. `rows` is served by `_in` filter or by offset/limit; like the real
 * API a page is silently truncated at OBJKT_PAGE_SIZE.
 */
function stubApi(rows: ObjktTokenRow[], collection: ObjktCollection | null = COLLECTION) {
  const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
    const { query, variables } = JSON.parse(String(init.body))
    if (query.includes('fa(')) {
      return Promise.resolve(jsonResponse({ data: { fa: collection ? [collection] : [] } }))
    }
    let page: ObjktTokenRow[]
    if (Array.isArray(variables.ids)) {
      const ids = new Set(variables.ids as string[])
      page = rows.filter((r) => ids.has(r.token_id))
    } else {
      const start = Number(variables.offset)
      page = rows.slice(start, start + Math.min(Number(variables.limit), OBJKT_PAGE_SIZE))
    }
    return Promise.resolve(jsonResponse({ data: { token: page } }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function tokenCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)))
    .filter((body) => body.query.includes('token('))
}

describe('isObjktContract', () => {
  it('accepts a KT1 address and rejects anything else', () => {
    expect(isObjktContract(KT1)).toBe(true)
    expect(isObjktContract('tz1QRkQzVLbCGLfMjRSsvKJ94KTvkmQiXAtY')).toBe(false)
    expect(isObjktContract('hicetnunc')).toBe(false)
    expect(isObjktContract(KT1.slice(0, -1))).toBe(false)
  })
})

describe('resolveObjktCollection', () => {
  beforeEach(() => vi.stubGlobal('fetch', undefined))
  afterEach(() => vi.unstubAllGlobals())

  it('returns a custom collection', async () => {
    const fetchMock = stubApi([])
    await expect(resolveObjktCollection(KT1)).resolves.toEqual(COLLECTION)
    expect(fetchMock.mock.calls[0][0]).toBe(OBJKT_GRAPHQL_URL)
  })

  it('throws not_found when objkt does not know the contract', async () => {
    stubApi([], null)
    const err = await expectVendorError(resolveObjktCollection(KT1))
    expect(err).toBeInstanceOf(VendorAPIError)
    expect(err.code).toBe('not_found')
  })

  it('refuses shared contracts with the collection name in the message', async () => {
    stubApi([], { name: 'hic et nunc', editions: 1, items: 771747, collection_type: 'open' })
    const err = await expectVendorError(resolveObjktCollection(KT1))
    expect(err.code).toBe('unsupported')
    expect(err.message).toMatch(/"hic et nunc" is a open contract/)
  })
})

describe('objktTokenToToken', () => {
  it('maps token_id to the mint number and resolves the artifact through the gateway', () => {
    expect(objktTokenToToken(KT1, row('7'))).toEqual({
      vendor: 'objkt',
      mintNumber: 7,
      chain: 'tezos',
      standard: 'fa2',
      contractAddress: KT1,
      tokenId: '7',
      title: 'Echoes #7',
      source: `${DEFAULT_IPFS_GATEWAY_BASE_URL}/artifact-7`,
    })
  })

  it('falls back to display_uri, then to no source', () => {
    expect(objktTokenToToken(KT1, row('1', { artifact_uri: null }))?.source).toBe(
      `${DEFAULT_IPFS_GATEWAY_BASE_URL}/display-1`
    )
    expect(objktTokenToToken(KT1, row('1', { artifact_uri: '', display_uri: null }))?.source).toBeNull()
  })

  it('falls back to the display when the artifact is not https', () => {
    expect(objktTokenToToken(KT1, row('1', { artifact_uri: 'onchfs://abc' }))?.source).toBe(
      `${DEFAULT_IPFS_GATEWAY_BASE_URL}/display-1`
    )
  })

  it('marks taken-down tokens as moderated and lets reports through', () => {
    expect(objktTokenToToken(KT1, row('1', { flag: 'banned' }))?.excluded).toBe('moderated')
    expect(objktTokenToToken(KT1, row('1', { flag: 'removed' }))?.excluded).toBe('moderated')
    expect(objktTokenToToken(KT1, row('1', { flag: 'flagged' }))?.excluded).toBeUndefined()
    expect(objktTokenToToken(KT1, row('1', { flag: null }))?.excluded).toBeUndefined()
  })

  it('skips token ids that cannot be a safe mint number', () => {
    expect(objktTokenToToken(KT1, row('12345678901234567890'))).toBeNull()
    expect(objktTokenToToken(KT1, row('abc'))).toBeNull()
  })
})

describe('loadObjktRelease', () => {
  beforeEach(() => vi.stubGlobal('fetch', undefined))
  afterEach(() => vi.unstubAllGlobals())

  it('rejects a non-KT1 slug before any request', async () => {
    const fetchMock = stubApi([])
    const err = await expectVendorError(loadObjktRelease('hicetnunc', null))
    expect(err.code).toBe('unsupported')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses items (not editions) as the release size', async () => {
    stubApi([row('1')])
    const result = await loadObjktRelease(KT1, null)
    expect(result.release).toEqual({ vendor: 'objkt', slug: KT1, name: 'qubibi: hello world', totalMints: 45 })
    expect(result.uncheckedMints).toEqual([])
  })

  it('does not fall back to editions (summed supply) for the release size', async () => {
    stubApi([row('1')], { ...COLLECTION, items: null })
    const result = await loadObjktRelease(KT1, null)
    expect(result.release.totalMints).toBeNull()
  })

  it('sorts numerically even though objkt orders token_id as text', async () => {
    const fetchMock = stubApi([row('1'), row('10'), row('2')])
    const result = await loadObjktRelease(KT1, null)
    expect(result.tokens.map((t) => t.mintNumber)).toEqual([1, 2, 10])
    expect(tokenCalls(fetchMock)[0].query).toMatch(/order_by: \{pk: asc\}/)
    expect(tokenCalls(fetchMock)[0].variables).toEqual({ contract: KT1, limit: OBJKT_PAGE_SIZE, offset: 0 })
    expect(result.wasCapped).toBe(false)
  })

  it('pages at exactly OBJKT_PAGE_SIZE and reports the cap when the size is unknown', async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => row(String(i + 1)))
    const fetchMock = stubApi(rows, { ...COLLECTION, items: null, editions: null })
    const result = await loadObjktRelease(KT1, null)
    expect(tokenCalls(fetchMock).map((c) => c.variables.offset)).toEqual([0, 500])
    expect(result.tokens).toHaveLength(LOAD_ALL_CAP)
    expect(result.wasCapped).toBe(true)
  })

  it('fetches a mint spec by token_id strings in batches', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => row(String(i + 1)))
    const fetchMock = stubApi(rows)
    const spec = Array.from({ length: OBJKT_TOKEN_ID_BATCH_SIZE + 1 }, (_, i) => i + 1)
    const result = await loadObjktRelease(KT1, spec)
    const calls = tokenCalls(fetchMock)
    expect(calls).toHaveLength(2)
    expect(calls[0].variables.ids).toHaveLength(OBJKT_TOKEN_ID_BATCH_SIZE)
    expect(calls[0].variables.ids[0]).toBe('1')
    expect(calls[1].variables).toEqual({ contract: KT1, ids: ['101'], limit: 1 })
    expect(result.tokens).toHaveLength(OBJKT_TOKEN_ID_BATCH_SIZE + 1)
    expect(result.tokens[100].mintNumber).toBe(101)
  })

  it('keeps moderated tokens in the result so gap detection sees them', async () => {
    stubApi([row('1', { flag: 'banned' }), row('2')])
    const result = await loadObjktRelease(KT1, [1, 2, 3])
    expect(result.tokens.map((t) => [t.mintNumber, t.excluded])).toEqual([
      [1, 'moderated'],
      [2, undefined],
    ])
  })
})
