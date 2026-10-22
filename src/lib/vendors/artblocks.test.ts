import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { expectVendorError } from '@/test/vendorErrors'
import {
  ARTBLOCKS_CHAIN_ID,
  ARTBLOCKS_GRAPHQL_URL,
  ARTBLOCKS_TOKENS_PAGE_SIZE,
  artBlocksTokenToToken,
  loadArtBlocksRelease,
  resolveArtBlocksProject,
  type ArtBlocksProject,
  type ArtBlocksTokenRow,
} from './artblocks'
import { LOAD_ALL_CAP } from './types'
import { VendorAPIError } from './http'

const CONTRACT = '0xa7d8d9ef8d8ce8992df33d8b8cf4aebabd5bd270'
const PROJECT: ArtBlocksProject = {
  id: `${CONTRACT}-78`,
  project_id: '78',
  contract_address: CONTRACT,
  name: 'Fidenza',
  artist_name: 'Tyler Hobbs',
  invocations: 999,
  max_invocations: 999,
}

function row(invocation: number, overrides: Partial<ArtBlocksTokenRow> = {}): ArtBlocksTokenRow {
  const tokenId = String(78_000_000 + invocation)
  return {
    token_id: tokenId,
    invocation,
    live_view_url: `https://generator.artblocks.io/1/${CONTRACT}/${tokenId}`,
    preview_asset_url: `https://media-proxy.artblocks.io/1/${CONTRACT}/${tokenId}.png`,
    ...overrides,
  }
}

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) }
}

/** Hasura stub: resolves the project and serves `total` tokens by offset/limit or by `_in`. */
function stubApi(total: number, project: ArtBlocksProject | null = PROJECT) {
  const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
    const { query, variables } = JSON.parse(String(init.body))
    if (query.includes('projects_metadata')) {
      return Promise.resolve(jsonResponse({ data: { projects_metadata: project ? [project] : [] } }))
    }
    let rows: ArtBlocksTokenRow[]
    if (Array.isArray(variables.invocations)) {
      rows = (variables.invocations as number[]).filter((i) => i < total).map((i) => row(i))
    } else {
      rows = []
      const start = Number(variables.offset)
      for (let i = start; i < Math.min(start + Number(variables.limit), total); i++) rows.push(row(i))
    }
    return Promise.resolve(jsonResponse({ data: { tokens_metadata: rows } }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function tokenCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)))
    .filter((body) => body.query.includes('tokens_metadata'))
    .map((body) => body.variables)
}

describe('resolveArtBlocksProject', () => {
  beforeEach(() => vi.stubGlobal('fetch', undefined))
  afterEach(() => vi.unstubAllGlobals())

  it('queries the mainnet endpoint by slug and chain id', async () => {
    const fetchMock = stubApi(0)
    const project = await resolveArtBlocksProject('fidenza-by-tyler-hobbs')
    expect(project).toEqual(PROJECT)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(ARTBLOCKS_GRAPHQL_URL)
    expect(JSON.parse(String(init.body)).variables).toEqual({
      slug: 'fidenza-by-tyler-hobbs',
      chainId: ARTBLOCKS_CHAIN_ID,
    })
  })

  it('throws not_found for an unknown slug', async () => {
    stubApi(0, null)
    const err = await expectVendorError(resolveArtBlocksProject('nope'))
    expect(err).toBeInstanceOf(VendorAPIError)
    expect(err.code).toBe('not_found')
  })
})

describe('artBlocksTokenToToken', () => {
  it('keeps the API token id, numbers mints from 1 and titles from 0', () => {
    expect(artBlocksTokenToToken(PROJECT, row(0))).toEqual({
      vendor: 'artblocks',
      mintNumber: 1,
      chain: 'evm',
      standard: 'erc721',
      contractAddress: '0xa7d8d9ef8D8Ce8992Df33D8b8CF4Aebabd5bD270',
      tokenId: '78000000',
      title: 'Fidenza #0',
      source: `https://generator.artblocks.io/1/${CONTRACT}/78000000`,
    })
  })

  it('falls back to the preview asset when there is no live view', () => {
    const token = artBlocksTokenToToken(PROJECT, row(3, { live_view_url: null }))
    expect(token?.source).toBe(`https://media-proxy.artblocks.io/1/${CONTRACT}/78000003.png`)
  })

  it('yields no source when neither URL is present', () => {
    const token = artBlocksTokenToToken(PROJECT, row(3, { live_view_url: '', preview_asset_url: null }))
    expect(token?.source).toBeNull()
  })

  it('skips a project whose contract address is not an EVM address', () => {
    expect(artBlocksTokenToToken({ ...PROJECT, contract_address: 'bad' }, row(0))).toBeNull()
  })
})

describe('loadArtBlocksRelease', () => {
  beforeEach(() => vi.stubGlobal('fetch', undefined))
  afterEach(() => vi.unstubAllGlobals())

  it('pages all tokens by offset using the composite project id', async () => {
    const fetchMock = stubApi(999)
    const result = await loadArtBlocksRelease('fidenza-by-tyler-hobbs', null)
    expect(tokenCalls(fetchMock)).toEqual([
      { projectId: PROJECT.id, limit: ARTBLOCKS_TOKENS_PAGE_SIZE, offset: 0 },
      { projectId: PROJECT.id, limit: ARTBLOCKS_TOKENS_PAGE_SIZE, offset: 500 },
    ])
    expect(result.tokens).toHaveLength(999)
    expect(result.tokens[0]).toMatchObject({ mintNumber: 1, tokenId: '78000000', title: 'Fidenza #0' })
    expect(result.tokens[998]).toMatchObject({ mintNumber: 999, tokenId: '78000998' })
    expect(result.wasCapped).toBe(false)
    expect(result.release).toEqual({
      vendor: 'artblocks',
      slug: 'fidenza-by-tyler-hobbs',
      name: 'Fidenza',
      totalMints: 999,
    })
  })

  it('caps a load-all at LOAD_ALL_CAP and reports it', async () => {
    const fetchMock = stubApi(10_000, { ...PROJECT, invocations: 10_000 })
    const result = await loadArtBlocksRelease('chromie-squiggle-by-snowfro', null)
    expect(tokenCalls(fetchMock)).toHaveLength(LOAD_ALL_CAP / ARTBLOCKS_TOKENS_PAGE_SIZE)
    expect(result.tokens).toHaveLength(LOAD_ALL_CAP)
    expect(result.wasCapped).toBe(true)
  })

  it('sends a mint spec as 0-based invocations in one request', async () => {
    const fetchMock = stubApi(999)
    const result = await loadArtBlocksRelease('fidenza-by-tyler-hobbs', [1, 2, 600])
    expect(tokenCalls(fetchMock)).toEqual([{ projectId: PROJECT.id, invocations: [0, 1, 599], limit: 3 }])
    expect(result.tokens.map((t) => t.mintNumber)).toEqual([1, 2, 600])
    expect(result.wasCapped).toBe(false)
  })

  it('splits a large spec into sequential batches', async () => {
    const fetchMock = stubApi(999)
    const spec = Array.from({ length: ARTBLOCKS_TOKENS_PAGE_SIZE + 1 }, (_, i) => i + 1)
    await loadArtBlocksRelease('fidenza-by-tyler-hobbs', spec)
    const calls = tokenCalls(fetchMock)
    expect(calls).toHaveLength(2)
    expect(calls[0].invocations).toHaveLength(ARTBLOCKS_TOKENS_PAGE_SIZE)
    expect(calls[1].invocations).toEqual([ARTBLOCKS_TOKENS_PAGE_SIZE])
  })

  it('omits mints the project has not minted (left to gap detection)', async () => {
    stubApi(10)
    const result = await loadArtBlocksRelease('small', [9, 10, 11])
    expect(result.tokens.map((t) => t.mintNumber)).toEqual([9, 10])
  })
})
