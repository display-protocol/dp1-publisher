import { describe, it, expect, afterEach } from 'vitest'
import { DEFAULT_IPFS_GATEWAY_BASE_URL, getIpfsGatewayBaseUrl, resolveIpfsUri } from './ipfs'

const CID = 'bafybeicnufmvwbgnqkcivv6k2oequjhfdlm42jkpiwaw5duhkhns2cnava'

describe('resolveIpfsUri', () => {
  afterEach(() => {
    delete (import.meta.env as Record<string, unknown>).VITE_IPFS_GATEWAY_BASE_URL
  })

  it('resolves a bare CID through the default gateway', () => {
    expect(resolveIpfsUri(`ipfs://${CID}`)).toBe(`${DEFAULT_IPFS_GATEWAY_BASE_URL}/${CID}`)
  })

  it('keeps path and query', () => {
    expect(resolveIpfsUri(`ipfs://${CID}/dir/index.html?x=1`)).toBe(
      `${DEFAULT_IPFS_GATEWAY_BASE_URL}/${CID}/dir/index.html?x=1`
    )
  })

  it('accepts the legacy ipfs://ipfs/<cid> form', () => {
    expect(resolveIpfsUri(`ipfs://ipfs/${CID}`)).toBe(`${DEFAULT_IPFS_GATEWAY_BASE_URL}/${CID}`)
  })

  it('leaves https and onchfs URIs untouched', () => {
    expect(resolveIpfsUri('https://example.com/a.mp4')).toBe('https://example.com/a.mp4')
    expect(resolveIpfsUri('onchfs://abc')).toBe('onchfs://abc')
  })

  it('honours the env override and strips a trailing slash', () => {
    ;(import.meta.env as Record<string, unknown>).VITE_IPFS_GATEWAY_BASE_URL =
      'https://gw.example/ipfs/'
    expect(getIpfsGatewayBaseUrl()).toBe('https://gw.example/ipfs')
    expect(resolveIpfsUri(`ipfs://${CID}`)).toBe(`https://gw.example/ipfs/${CID}`)
  })
})
