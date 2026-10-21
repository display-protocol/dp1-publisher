import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { expectVendorError } from '@/test/vendorErrors'
import { fetchJson, graphqlRequest, VendorAPIError } from './http'

function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  })
}

describe('fetchJson', () => {
  beforeEach(() => vi.stubGlobal('fetch', undefined))
  afterEach(() => vi.unstubAllGlobals())

  it('returns the parsed body on success', async () => {
    vi.stubGlobal('fetch', mockFetch({ result: [1] }))
    await expect(fetchJson('feralfile', 'https://x/y')).resolves.toEqual({ result: [1] })
  })

  it('throws an http error carrying the status', async () => {
    vi.stubGlobal('fetch', mockFetch({}, false, 503))
    const err = await expectVendorError(fetchJson('artblocks', 'https://x'))
    expect(err).toBeInstanceOf(VendorAPIError)
    expect(err.code).toBe('http')
    expect(err.status).toBe(503)
    expect(err.vendor).toBe('artblocks')
    expect(err.message).toMatch(/Art Blocks request failed \(503\)/)
  })

  it('mentions rate limiting on 429', async () => {
    vi.stubGlobal('fetch', mockFetch({}, false, 429))
    const err = await expectVendorError(fetchJson('objkt', 'https://x'))
    expect(err.message).toMatch(/rate limited/)
  })

  it('maps a thrown fetch to a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const err = await expectVendorError(fetchJson('feralfile', 'https://x'))
    expect(err).toBeInstanceOf(VendorAPIError)
    expect(err.code).toBe('network')
    // Feral File is the vendor whose CORS posture needs the dev proxy; the hint is vendor-specific.
    expect(err.message).toMatch(/Vite proxy/)
  })

  it('maps a timeout to a network error that says so', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'))
    )
    const err = await expectVendorError(fetchJson('artblocks', 'https://x'))
    expect(err.code).toBe('network')
    expect(err.message).toMatch(/did not respond in time/)
  })

  it('reports a timeout while reading the body as a timeout, not malformed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')),
      })
    )
    const err = await expectVendorError(fetchJson('feralfile', 'https://x'))
    expect(err.code).toBe('network')
    expect(err.message).toMatch(/did not respond in time/)
  })

  it('passes an abort signal so a stalled request ends', async () => {
    const fetchMock = mockFetch({})
    vi.stubGlobal('fetch', fetchMock)
    await fetchJson('objkt', 'https://x')
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it('does not mention the proxy for other vendors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const err = await expectVendorError(fetchJson('objkt', 'https://x'))
    expect(err.code).toBe('network')
    expect(err.message).not.toMatch(/proxy/)
  })

  it('maps a JSON parse failure to a malformed error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.reject(new Error('bad')) })
    )
    const err = await expectVendorError(fetchJson('feralfile', 'https://x'))
    expect(err.code).toBe('malformed')
  })
})

describe('graphqlRequest', () => {
  beforeEach(() => vi.stubGlobal('fetch', undefined))
  afterEach(() => vi.unstubAllGlobals())

  it('posts {query, variables} as JSON and returns data', async () => {
    const fetchMock = mockFetch({ data: { fa: [] } })
    vi.stubGlobal('fetch', fetchMock)
    const data = await graphqlRequest('objkt', 'https://gql', 'query Q($a: Int!) { x }', { a: 1 })
    expect(data).toEqual({ fa: [] })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://gql')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ query: 'query Q($a: Int!) { x }', variables: { a: 1 } })
  })

  it('throws a graphql error joining all messages', async () => {
    vi.stubGlobal('fetch', mockFetch({ errors: [{ message: 'one' }, { message: 'two' }] }))
    const err = await expectVendorError(graphqlRequest('artblocks', 'https://gql', '{x}', {}))
    expect(err.code).toBe('graphql')
    expect(err.message).toMatch(/one; two/)
  })

  it('throws when data is missing', async () => {
    vi.stubGlobal('fetch', mockFetch({}))
    const err = await expectVendorError(graphqlRequest('artblocks', 'https://gql', '{x}', {}))
    expect(err.code).toBe('malformed')
  })
})
