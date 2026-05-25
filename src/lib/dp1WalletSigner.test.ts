/**
 * Tests for wallet signer-identity helpers.
 *
 * The critical regression guard is the non-empty-curators-without-wallet case
 * — when an imported playlist already declares a `did:key` curator from
 * `dp1-cli` and the JSON-tab CREATE path signs with the connected wallet's
 * `did:pkh`, the published payload must include the wallet DID in
 * `curators[]` or the feed rejects ("no valid curator signature found").
 */

import { describe, it, expect } from 'vitest'
import {
  ensureChannelWalletPublisher,
  ensurePlaylistGroupWalletCurator,
  ensurePlaylistWalletCurator,
} from '@/lib/dp1WalletSigner'
import type { Channel, Entity, Playlist, PlaylistGroup } from '@/types/dp1'

const WALLET = 'did:pkh:eip155:1:0xabcdef0123456789abcdef0123456789abcdef01'
const DID_KEY = 'did:key:z6MkExampleDidKeyFromDp1Cli'
const OTHER_PKH = 'did:pkh:eip155:1:0x0000000000000000000000000000000000000001'

const basePlaylist: Playlist = {
  dpVersion: '1.1.0',
  title: 'Test',
  items: [{ source: 'https://example.com/v.m3u8' }],
}

const baseChannel: Channel = {
  title: 'Test channel',
  version: '1.0.0',
  playlists: ['https://example.com/p.json'],
}

describe('ensurePlaylistWalletCurator', () => {
  it('injects when curators is missing', () => {
    const r = ensurePlaylistWalletCurator(basePlaylist, WALLET)
    expect(r.injected).toBe(true)
    expect(r.previousCount).toBe(0)
    expect(r.playlist.curators).toEqual([{ name: '', key: WALLET, url: '' }])
  })

  it('injects when curators is empty', () => {
    const r = ensurePlaylistWalletCurator({ ...basePlaylist, curators: [] }, WALLET)
    expect(r.injected).toBe(true)
    expect(r.previousCount).toBe(0)
    expect(r.playlist.curators).toEqual([{ name: '', key: WALLET, url: '' }])
  })

  it('appends wallet when curators present without it (regression guard for did:key from dp1-cli)', () => {
    const r = ensurePlaylistWalletCurator(
      {
        ...basePlaylist,
        curators: [{ name: 'NODE', key: DID_KEY, url: 'https://node.art' }],
      },
      WALLET
    )
    expect(r.injected).toBe(true)
    expect(r.previousCount).toBe(1)
    expect(r.playlist.curators).toHaveLength(2)
    expect(r.playlist.curators?.[0]).toEqual({
      name: 'NODE',
      key: DID_KEY,
      url: 'https://node.art',
    })
    expect(r.playlist.curators?.[1]).toEqual({ name: '', key: WALLET, url: '' })
  })

  it('appends wallet when curators contains other PKH addresses', () => {
    const r = ensurePlaylistWalletCurator(
      { ...basePlaylist, curators: [{ name: 'Alice', key: OTHER_PKH, url: '' }] },
      WALLET
    )
    expect(r.injected).toBe(true)
    expect(r.playlist.curators).toHaveLength(2)
    expect(r.playlist.curators?.[1].key).toBe(WALLET)
  })

  it('does not inject when the wallet is the only curator', () => {
    const original = {
      ...basePlaylist,
      curators: [{ name: 'Sean', key: WALLET, url: '' }],
    }
    const r = ensurePlaylistWalletCurator(original, WALLET)
    expect(r.injected).toBe(false)
    expect(r.previousCount).toBe(1)
    expect(r.playlist.curators).toEqual([{ name: 'Sean', key: WALLET, url: '' }])
  })

  it('does not inject when the wallet is already present alongside others', () => {
    const original = {
      ...basePlaylist,
      curators: [
        { name: 'NODE', key: DID_KEY, url: '' },
        { name: 'Sean', key: WALLET, url: '' },
      ],
    }
    const r = ensurePlaylistWalletCurator(original, WALLET)
    expect(r.injected).toBe(false)
    expect(r.previousCount).toBe(2)
    expect(r.playlist.curators).toEqual([
      { name: 'NODE', key: DID_KEY, url: '' },
      { name: 'Sean', key: WALLET, url: '' },
    ])
  })

  // Regression: bot review found that `{ key: WALLET }` without name was
  // returned as-is, then entityWire emitted name: undefined which JSON.stringify
  // drops — contradicting the wire contract that name is always emitted.
  it('defaults missing name to empty string on preserved wallet entry', () => {
    const playlist = {
      ...basePlaylist,
      curators: [{ key: WALLET } as unknown as Entity],
    }
    const r = ensurePlaylistWalletCurator(playlist, WALLET)
    expect(r.injected).toBe(false)
    expect(r.playlist.curators).toEqual([{ name: '', key: WALLET, url: undefined }])
  })

  it('coerces non-string name to empty string on preserved wallet entry', () => {
    const playlist = {
      ...basePlaylist,
      curators: [{ name: 123, key: WALLET } as unknown as Entity],
    }
    const r = ensurePlaylistWalletCurator(playlist, WALLET)
    expect(r.injected).toBe(false)
    expect(r.playlist.curators?.[0].name).toBe('')
  })

  it('does not mutate the input playlist', () => {
    const input = {
      ...basePlaylist,
      curators: [{ name: 'NODE', key: DID_KEY, url: '' }],
    }
    const snapshot = JSON.stringify(input)
    ensurePlaylistWalletCurator(input, WALLET)
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  // Defensiveness: parsePlaylistJson only validates `title` and `items`, so
  // imported `curators` can be any shape. These regression tests guard the
  // JSON-tab create path against signing on garbage curator data.

  it('treats curators-as-object as no curators and injects wallet', () => {
    const playlist = {
      ...basePlaylist,
      curators: {} as unknown as Entity[],
    }
    const r = ensurePlaylistWalletCurator(playlist, WALLET)
    expect(r.injected).toBe(true)
    expect(r.previousCount).toBe(0)
    expect(r.playlist.curators).toEqual([{ name: '', key: WALLET, url: '' }])
  })

  it('treats curators-as-null as no curators and injects wallet', () => {
    const playlist = {
      ...basePlaylist,
      curators: null as unknown as Entity[],
    }
    const r = ensurePlaylistWalletCurator(playlist, WALLET)
    expect(r.injected).toBe(true)
    expect(r.playlist.curators).toEqual([{ name: '', key: WALLET, url: '' }])
  })

  it('drops null entries from a curators array and appends wallet', () => {
    const playlist = {
      ...basePlaylist,
      curators: [
        null,
        { name: 'NODE', key: DID_KEY, url: '' },
        undefined,
      ] as unknown as Entity[],
    }
    const r = ensurePlaylistWalletCurator(playlist, WALLET)
    expect(r.injected).toBe(true)
    expect(r.previousCount).toBe(1)
    expect(r.playlist.curators).toEqual([
      { name: 'NODE', key: DID_KEY, url: '' },
      { name: '', key: WALLET, url: '' },
    ])
  })

  it('drops entries missing key and appends wallet', () => {
    const playlist = {
      ...basePlaylist,
      curators: [
        { name: 'Anonymous', url: '' } as unknown as Entity,
        { name: 'NODE', key: DID_KEY, url: '' },
      ],
    }
    const r = ensurePlaylistWalletCurator(playlist, WALLET)
    expect(r.injected).toBe(true)
    expect(r.previousCount).toBe(1)
    expect(r.playlist.curators).toHaveLength(2)
    expect(r.playlist.curators?.[0].key).toBe(DID_KEY)
    expect(r.playlist.curators?.[1].key).toBe(WALLET)
  })

  it('cleans garbage entries even when wallet is already declared', () => {
    const playlist = {
      ...basePlaylist,
      curators: [
        null,
        { name: 'Sean', key: WALLET, url: '' },
        { invalid: true } as unknown as Entity,
      ] as unknown as Entity[],
    }
    const r = ensurePlaylistWalletCurator(playlist, WALLET)
    expect(r.injected).toBe(false)
    expect(r.previousCount).toBe(1)
    expect(r.playlist.curators).toEqual([{ name: 'Sean', key: WALLET, url: '' }])
  })
})

describe('ensureChannelWalletPublisher', () => {
  it('adds publisher when missing', () => {
    const r = ensureChannelWalletPublisher(baseChannel, WALLET)
    expect(r.updated).toBe(true)
    expect(r.previousKey).toBeUndefined()
    expect(r.channel.publisher).toEqual({ name: '', key: WALLET, url: undefined })
  })

  it('replaces did:key publisher with wallet, preserving name and url', () => {
    const r = ensureChannelWalletPublisher(
      {
        ...baseChannel,
        publisher: { name: 'NODE', key: DID_KEY, url: 'https://node.art' },
      },
      WALLET
    )
    expect(r.updated).toBe(true)
    expect(r.previousKey).toBe(DID_KEY)
    expect(r.channel.publisher).toEqual({
      name: 'NODE',
      key: WALLET,
      url: 'https://node.art',
    })
  })

  it('replaces a different PKH publisher with the connected wallet', () => {
    const r = ensureChannelWalletPublisher(
      { ...baseChannel, publisher: { name: 'Alice', key: OTHER_PKH, url: '' } },
      WALLET
    )
    expect(r.updated).toBe(true)
    expect(r.previousKey).toBe(OTHER_PKH)
    expect(r.channel.publisher?.key).toBe(WALLET)
    expect(r.channel.publisher?.name).toBe('Alice')
  })

  it('is a no-op when publisher.key already matches the wallet', () => {
    const original = {
      ...baseChannel,
      publisher: { name: 'NODE', key: WALLET, url: '' },
    }
    const r = ensureChannelWalletPublisher(original, WALLET)
    expect(r.updated).toBe(false)
    expect(r.previousKey).toBe(WALLET)
    expect(r.channel).toBe(original)
  })

  it('does not mutate the input channel', () => {
    const input = {
      ...baseChannel,
      publisher: { name: 'NODE', key: DID_KEY, url: 'https://node.art' },
    }
    const snapshot = JSON.stringify(input)
    ensureChannelWalletPublisher(input, WALLET)
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  // Defensive coverage for malformed JSON-imported publishers. The bot
  // review noted that `previousKey` could end up as a non-string (e.g.,
  // a number from `{ key: 123 }`), which crashed the caller's toast at
  // `previousKey.slice(...)`. The helper now always exposes `previousKey`
  // as `string | undefined`.

  it('treats non-string publisher.key as missing and exposes undefined previousKey', () => {
    const r = ensureChannelWalletPublisher(
      {
        ...baseChannel,
        publisher: { name: 'NODE', key: 123 as unknown as string, url: '' },
      },
      WALLET
    )
    expect(r.updated).toBe(true)
    expect(r.previousKey).toBeUndefined()
    expect(r.channel.publisher?.key).toBe(WALLET)
    expect(r.channel.publisher?.name).toBe('NODE')
  })

  it('treats non-object publisher (string) as missing and reports undefined previousKey', () => {
    const r = ensureChannelWalletPublisher(
      { ...baseChannel, publisher: 'oops' as unknown as Channel['publisher'] },
      WALLET
    )
    expect(r.updated).toBe(true)
    expect(r.previousKey).toBeUndefined()
    expect(r.channel.publisher).toEqual({ name: '', key: WALLET, url: undefined })
  })

  it('treats null publisher as missing', () => {
    const r = ensureChannelWalletPublisher(
      { ...baseChannel, publisher: null as unknown as Channel['publisher'] },
      WALLET
    )
    expect(r.updated).toBe(true)
    expect(r.previousKey).toBeUndefined()
    expect(r.channel.publisher?.key).toBe(WALLET)
  })

  it('coerces non-string publisher.name to empty string while replacing key', () => {
    const r = ensureChannelWalletPublisher(
      {
        ...baseChannel,
        publisher: { name: 42 as unknown as string, key: DID_KEY, url: 'https://node.art' },
      },
      WALLET
    )
    expect(r.updated).toBe(true)
    expect(r.previousKey).toBe(DID_KEY)
    expect(r.channel.publisher).toEqual({
      name: '',
      key: WALLET,
      url: 'https://node.art',
    })
  })

  // Regression guard for the channel JSON-edit PATCH body bug: the previous
  // edit-path code signed the helper-repaired document (good) but built the
  // PATCH body from the original `patchFields.publisher` (bad — the imported
  // did:key publisher, not the wallet-repaired one). The feed then received a
  // doc whose declared publisher didn't match the wallet-signed payload.
  //
  // After the fix, the PATCH body publisher MUST equal the repaired
  // `ensured.channel.publisher` — the value used to build the signed payload.
  it('repaired publisher is suitable for use as both the signed doc and the PATCH body publisher', () => {
    const importedPublisher = {
      name: 'NODE',
      key: DID_KEY,
      url: 'https://node.art',
    }
    const channel: Channel = { ...baseChannel, publisher: importedPublisher }
    const r = ensureChannelWalletPublisher(channel, WALLET)

    // Signed document uses r.channel.publisher.
    expect(r.channel.publisher?.key).toBe(WALLET)
    expect(r.channel.publisher?.name).toBe('NODE')
    expect(r.channel.publisher?.url).toBe('https://node.art')

    // If a caller passes the *original* importedPublisher into the PATCH
    // body (the previous bug), the declared publisher wouldn't match the
    // wallet-signed payload. The helper's `ensured.channel.publisher` is
    // therefore the only correct source for both signing AND PATCH body —
    // which the edit handler now uses by writing it back into patchFields.
    expect(r.channel.publisher).not.toEqual(importedPublisher)
  })
})

describe('ensurePlaylistGroupWalletCurator', () => {
  const baseGroup: PlaylistGroup = {
    id: 'grp-1',
    created: '2026-05-22T00:00:00Z',
    title: 'Test Group',
    playlists: ['https://example.com/p1'],
  }

  it('adds wallet curator when missing', () => {
    const r = ensurePlaylistGroupWalletCurator(baseGroup, WALLET)
    expect(r.updated).toBe(true)
    expect(r.previousCurator).toBeUndefined()
    expect(r.group.curator).toBe(WALLET)
  })

  it('replaces did:key curator with wallet', () => {
    const r = ensurePlaylistGroupWalletCurator({ ...baseGroup, curator: DID_KEY }, WALLET)
    expect(r.updated).toBe(true)
    expect(r.previousCurator).toBe(DID_KEY)
    expect(r.group.curator).toBe(WALLET)
  })

  it('no-op when curator already matches wallet', () => {
    const r = ensurePlaylistGroupWalletCurator({ ...baseGroup, curator: WALLET }, WALLET)
    expect(r.updated).toBe(false)
    expect(r.group.curator).toBe(WALLET)
  })

  it('repaired curator is suitable for both signing and PATCH body', () => {
    const r = ensurePlaylistGroupWalletCurator({ ...baseGroup, curator: DID_KEY }, WALLET)
    expect(r.group.curator).toBe(WALLET)
    expect(r.group.curator).not.toBe(DID_KEY)
  })
})
