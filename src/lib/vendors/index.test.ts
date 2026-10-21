import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadVendorRelease } from './index'
import * as feralfile from './feralfile'
import * as artblocks from './artblocks'
import * as objkt from './objkt'
import { finalizeTokens } from './tokens'
import type { VendorLoadResult, VendorToken } from './types'

const RESULT: VendorLoadResult = {
  release: { vendor: 'feralfile', slug: 'x', name: null, totalMints: null },
  tokens: [],
  wasCapped: false,
  uncheckedMints: [],
}

describe('loadVendorRelease', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('dispatches to the Feral File loader with a trimmed slug', async () => {
    const spy = vi.spyOn(feralfile, 'loadFeralFileRelease').mockResolvedValue(RESULT)
    await loadVendorRelease('feralfile', '  my-series ', [1, 2])
    expect(spy).toHaveBeenCalledWith('my-series', [1, 2])
  })

  it('dispatches to the Art Blocks loader', async () => {
    const spy = vi.spyOn(artblocks, 'loadArtBlocksRelease').mockResolvedValue(RESULT)
    await loadVendorRelease('artblocks', 'fidenza-by-tyler-hobbs', null)
    expect(spy).toHaveBeenCalledWith('fidenza-by-tyler-hobbs', null)
  })

  it('dispatches to the objkt loader', async () => {
    const spy = vi.spyOn(objkt, 'loadObjktRelease').mockResolvedValue(RESULT)
    await loadVendorRelease('objkt', 'KT1XR4XgBJ2RZz1vW22q6EKdSNgYbmaaWr5z', null)
    expect(spy).toHaveBeenCalledWith('KT1XR4XgBJ2RZz1vW22q6EKdSNgYbmaaWr5z', null)
  })
})

describe('finalizeTokens', () => {
  const token = (mintNumber: number, tokenId = String(mintNumber)): VendorToken => ({
    vendor: 'objkt',
    mintNumber,
    chain: 'tezos',
    standard: 'fa2',
    contractAddress: 'KT1',
    tokenId,
    title: null,
    source: null,
  })

  it('sorts by mint number and drops duplicates, keeping the first', () => {
    const out = finalizeTokens([token(10), { ...token(2), title: 'first' }, token(1), { ...token(2), title: 'dup' }])
    expect(out.map((t) => t.mintNumber)).toEqual([1, 2, 10])
    expect(out[1].title).toBe('first')
  })

  it('keys duplicates by contract and token id', () => {
    const out = finalizeTokens([token(1), { ...token(2, '1'), contractAddress: 'KT2' }])
    expect(out).toHaveLength(2)
  })

  it('keeps https sources and drops every other scheme', () => {
    const out = finalizeTokens([
      { ...token(1), source: 'https://a.example/x.png' },
      { ...token(2), source: 'http://a.example/x.png' },
      { ...token(3), source: 'data:image/png;base64,AAAA' },
      { ...token(4), source: 'onchfs://abc' },
      { ...token(5), source: 'not a url' },
    ])
    expect(out.map((t) => t.source)).toEqual(['https://a.example/x.png', null, null, null, null])
  })
})
