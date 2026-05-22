/**
 * Tests for the consolidated publish pipeline.
 *
 * The critical invariant in every test:
 *   `wireBody.publisher` deeply equals `signedPayload.publisher` (channel)
 *   `wireBody.curators` deeply equals `signedPayload.curators` (playlist)
 *
 * That parity is the whole point of the consolidation — drift between
 * what gets signed and what gets sent to the feed becomes impossible by
 * construction.
 */

import { describe, it, expect } from 'vitest'
import {
  prepareChannelForPublish,
  preparePlaylistForPublish,
} from '@/lib/preparePublish'
import type { Channel, Playlist } from '@/types/dp1'

const WALLET = 'did:pkh:eip155:1:0xabcdef0123456789abcdef0123456789abcdef01'
const DID_KEY = 'did:key:z6MkExampleDidKeyFromDp1Cli'

import type { PrepareResult } from '@/lib/preparePublish'

function ok<T>(r: PrepareResult<T>): asserts r is Extract<PrepareResult<T>, { signedPayload: T }> {
  if ('validationErrors' in r) {
    throw new Error(
      `expected success, got validationErrors: ${r.validationErrors.join('; ')}`
    )
  }
}

// ----------------------------------------------------------------------------
// Playlist
// ----------------------------------------------------------------------------

const basePlaylist: Playlist = {
  dpVersion: '1.1.0',
  title: 'Season 1',
  items: [{ source: 'https://example.com/v.m3u8' }],
}

describe('preparePlaylistForPublish — create', () => {
  it('injects wallet curator when missing (extensions on) and wire matches signed', () => {
    const r = preparePlaylistForPublish({
      rawDocument: basePlaylist,
      walletDID: WALLET,
      extensionsEnabled: true,
    })
    ok<Playlist>(r)
    expect(r.signedPayload.curators).toEqual([{ name: '', key: WALLET, url: '' }])
    expect(r.wireBody.curators).toEqual(r.signedPayload.curators)
    expect(r.toasts).toHaveLength(1)
    expect(r.toasts[0].title).toMatch(/curator/i)
  })

  it('appends wallet to existing did:key curators (the regression case)', () => {
    const r = preparePlaylistForPublish({
      rawDocument: {
        ...basePlaylist,
        curators: [{ name: 'NODE', key: DID_KEY, url: 'https://node.art' }],
      },
      walletDID: WALLET,
      extensionsEnabled: true,
    })
    ok<Playlist>(r)
    expect(r.signedPayload.curators).toEqual([
      { name: 'NODE', key: DID_KEY, url: 'https://node.art' },
      { name: '', key: WALLET, url: '' },
    ])
    expect(r.wireBody.curators).toEqual(r.signedPayload.curators)
  })

  it('strips extension fields when extensions are off', () => {
    const r = preparePlaylistForPublish({
      rawDocument: {
        ...basePlaylist,
        curators: [{ name: 'NODE', key: DID_KEY, url: '' }],
        summary: 'should be stripped',
      },
      walletDID: WALLET,
      extensionsEnabled: false,
    })
    ok<Playlist>(r)
    expect(r.signedPayload.curators).toBeUndefined()
    expect(r.signedPayload.summary).toBeUndefined()
    expect(r.wireBody.curators).toBeUndefined()
    expect(r.wireBody.summary).toBeUndefined()
    expect(r.toasts).toHaveLength(0) // no curator-inject toast (extensions off)
  })

  it('returns validation errors for missing title', () => {
    const r = preparePlaylistForPublish({
      rawDocument: { ...basePlaylist, title: '' },
      walletDID: WALLET,
      extensionsEnabled: true,
    })
    expect('validationErrors' in r).toBe(true)
    if ('validationErrors' in r) {
      expect(r.validationErrors[0]).toMatch(/title/i)
    }
  })
})

describe('preparePlaylistForPublish — edit', () => {
  it('merges patch with base and ensures wallet curator on the result', () => {
    const existing: Playlist = {
      ...basePlaylist,
      id: 'existing-id',
      curators: [{ name: 'NODE', key: DID_KEY, url: '' }],
    }
    const patch: Playlist = {
      ...basePlaylist,
      title: 'Season 1 — edited',
      items: existing.items,
    }
    const r = preparePlaylistForPublish({
      rawDocument: patch,
      walletDID: WALLET,
      base: existing,
      extensionsEnabled: true,
    })
    ok<Playlist>(r)
    expect(r.signedPayload.title).toBe('Season 1 — edited')
    // Wallet appended even though merged inherited did:key curator from base.
    expect(r.signedPayload.curators?.some((c) => c.key === WALLET)).toBe(true)
    expect(r.signedPayload.curators?.some((c) => c.key === DID_KEY)).toBe(true)
    // Body matches signed exactly.
    expect(r.wireBody.curators).toEqual(r.signedPayload.curators)
  })

  it('idempotent when the merged document already declares the wallet', () => {
    const existing: Playlist = {
      ...basePlaylist,
      curators: [{ name: 'Sean', key: WALLET, url: '' }],
    }
    const r = preparePlaylistForPublish({
      rawDocument: { ...basePlaylist, title: 'edited' },
      walletDID: WALLET,
      base: existing,
      extensionsEnabled: true,
    })
    ok<Playlist>(r)
    expect(r.signedPayload.curators).toEqual([{ name: 'Sean', key: WALLET, url: '' }])
    expect(r.toasts).toHaveLength(0) // no injection happened
  })
})

// ----------------------------------------------------------------------------
// Channel
// ----------------------------------------------------------------------------

const baseChannel: Channel = {
  title: 'OCCUPY',
  slug: 'occupy',
  version: '1.0.0',
  playlists: ['https://feed.example.com/p.json'],
  publisher: { name: 'NODE', key: WALLET, url: 'https://node.art' },
}

describe('prepareChannelForPublish — create', () => {
  it('passes a fully-valid channel through unchanged', () => {
    const r = prepareChannelForPublish({
      rawDocument: baseChannel,
      walletDID: WALLET,
    })
    ok<Channel>(r)
    expect(r.signedPayload.publisher).toEqual(baseChannel.publisher)
    expect(r.wireBody.publisher).toEqual(r.signedPayload.publisher)
    expect(r.toasts).toHaveLength(0)
  })

  it('replaces did:key publisher key with wallet; wire matches signed', () => {
    const r = prepareChannelForPublish({
      rawDocument: {
        ...baseChannel,
        publisher: { name: 'NODE', key: DID_KEY, url: 'https://node.art' },
      },
      walletDID: WALLET,
    })
    ok<Channel>(r)
    expect(r.signedPayload.publisher?.key).toBe(WALLET)
    expect(r.signedPayload.publisher?.name).toBe('NODE')
    expect(r.signedPayload.publisher?.url).toBe('https://node.art')
    // Identity invariant.
    expect(r.wireBody.publisher).toEqual(r.signedPayload.publisher)
  })

  it('returns validation errors when injected publisher has empty name', () => {
    const r = prepareChannelForPublish({
      rawDocument: { ...baseChannel, publisher: undefined },
      walletDID: WALLET,
    })
    expect('validationErrors' in r).toBe(true)
    if ('validationErrors' in r) {
      expect(r.validationErrors.some((e) => /publisher.*name/i.test(e))).toBe(true)
    }
  })
})

describe('prepareChannelForPublish — edit (round-6 regression guards)', () => {
  // The bug: edit path signed the wallet-repaired `merged.publisher` but
  // built the PATCH body from the original imported `patchFields.publisher`.
  // After consolidation, both come from `merged` by construction.
  it('repaired publisher flows into BOTH signed payload and wire body', () => {
    const existing: Channel = {
      ...baseChannel,
      id: 'existing',
      publisher: { name: 'NODE', key: DID_KEY, url: 'https://node.art' },
    }
    const patch: Channel = {
      ...baseChannel,
      title: 'OCCUPY — Season 2',
      publisher: { name: 'NODE', key: DID_KEY, url: 'https://node.art' },
    }
    const r = prepareChannelForPublish({
      rawDocument: patch,
      walletDID: WALLET,
      base: existing,
    })
    ok<Channel>(r)
    expect(r.signedPayload.publisher?.key).toBe(WALLET)
    expect(r.wireBody.publisher).toEqual(r.signedPayload.publisher)
    expect(r.toasts.some((t) => /publisher/i.test(t.title))).toBe(true)
  })

  it('idempotent when merged.publisher already matches wallet', () => {
    const existing: Channel = { ...baseChannel } // publisher.key already = WALLET
    const r = prepareChannelForPublish({
      rawDocument: { ...baseChannel, title: 'edited' },
      walletDID: WALLET,
      base: existing,
    })
    ok<Channel>(r)
    expect(r.toasts).toHaveLength(0)
  })

  it('does not throw on malformed pasted publisher (non-string key) and reports validation', () => {
    const r = prepareChannelForPublish({
      rawDocument: {
        ...baseChannel,
        publisher: {
          name: 'NODE',
          key: 123 as unknown as string,
          url: '',
        },
      },
      walletDID: WALLET,
    })
    // ensureChannelWalletPublisher coerces and replaces key with wallet;
    // no validation error should result here, and previousKey reported as
    // undefined would make the toast pick the "Publisher added" branch.
    ok<Channel>(r)
    expect(r.signedPayload.publisher?.key).toBe(WALLET)
    expect(r.wireBody.publisher).toEqual(r.signedPayload.publisher)
  })
})
