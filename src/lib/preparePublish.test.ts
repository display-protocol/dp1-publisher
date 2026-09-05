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
import type { Channel, Entity, Playlist } from '@/types/dp1'

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
  id: 'pl-base-0000',
  created: '2026-05-22T00:00:00Z',
  title: 'Season 1',
  items: [{ source: 'https://example.com/v.m3u8' }],
}

describe('preparePlaylistForPublish — create', () => {
  it('injects wallet curator when missing (extensions on) and wire matches signed bytes', () => {
    const r = preparePlaylistForPublish({
      rawDocument: basePlaylist,
      walletDID: WALLET,
      extensionsEnabled: true,
    })
    ok<Playlist>(r)
    // signedPayload (typed) retains empty url; signedBytes (canonical) drops it.
    expect(r.signedPayload.curators).toEqual([{ name: '', key: WALLET, url: '' }])
    expect(r.signedBytes.curators).toEqual([{ name: '', key: WALLET }])
    // The critical invariant: what gets POSTed exactly equals what was hashed.
    expect(r.wireBody).toEqual(r.signedBytes)
    expect(r.toasts.some((t) => /curator/i.test(t.title))).toBe(true)
    // basePlaylist carries no slug, so the auto-slug receipt also fires.
    expect(r.toasts.some((t) => /slug/i.test(t.title))).toBe(true)
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
    // Canonical form drops empty url from the appended wallet entry.
    expect(r.signedBytes.curators).toEqual([
      { name: 'NODE', key: DID_KEY, url: 'https://node.art' },
      { name: '', key: WALLET },
    ])
    expect(r.wireBody).toEqual(r.signedBytes)
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
    expect(r.toasts.some((t) => /curator/i.test(t.title))).toBe(false) // no curator-inject toast (extensions off)
  })

  it('keeps item displayAt in signed bytes and wire body (extensions on)', () => {
    const r = preparePlaylistForPublish({
      rawDocument: {
        ...basePlaylist,
        items: [
          { source: 'https://example.com/day1.html', displayAt: '2026-07-21T00:00:00' },
          { source: 'https://example.com/evergreen.html' },
        ],
      },
      walletDID: WALLET,
      extensionsEnabled: true,
    })
    ok<Playlist>(r)
    const items = r.signedBytes.items as Array<Record<string, unknown>>
    expect(items[0].displayAt).toBe('2026-07-21T00:00:00')
    expect(items[1]).not.toHaveProperty('displayAt')
    expect(r.wireBody).toEqual(r.signedBytes)
  })

  it('strips item displayAt when extensions are off (core-only feed)', () => {
    const r = preparePlaylistForPublish({
      rawDocument: {
        ...basePlaylist,
        items: [{ source: 'https://example.com/day1.html', displayAt: '2026-07-21T00:00:00' }],
      },
      walletDID: WALLET,
      extensionsEnabled: false,
    })
    ok<Playlist>(r)
    const items = r.signedBytes.items as Array<Record<string, unknown>>
    expect(items[0]).not.toHaveProperty('displayAt')
    expect(r.wireBody).toEqual(r.signedBytes)
  })

  it('keeps item inlineManifest in signed bytes and wire body (extensions on)', () => {
    const inlineManifest = {
      refVersion: '0.1.0',
      id: 'ref-9d26ecb3',
      created: '2026-07-28T00:00:00Z',
      locale: 'en',
      metadata: { title: 'Pre-Process', artists: [{ name: 'Casey Reas', id: '' }] },
    }
    const r = preparePlaylistForPublish({
      rawDocument: {
        ...basePlaylist,
        items: [
          { source: 'https://example.com/art/pre-process.html', inlineManifest },
          { source: 'https://example.com/plain.html' },
        ],
      },
      walletDID: WALLET,
      extensionsEnabled: true,
    })
    ok<Playlist>(r)
    const items = r.signedBytes.items as Array<Record<string, unknown>>
    expect(items[0].inlineManifest).toEqual(inlineManifest)
    expect(items[1]).not.toHaveProperty('inlineManifest')
    expect(r.wireBody).toEqual(r.signedBytes)
  })

  it('strips item inlineManifest when extensions are off (core-only feed)', () => {
    const r = preparePlaylistForPublish({
      rawDocument: {
        ...basePlaylist,
        items: [
          {
            source: 'https://example.com/art/pre-process.html',
            inlineManifest: {
              refVersion: '0.1.0',
              id: 'ref-9d26ecb3',
              created: '2026-07-28T00:00:00Z',
              locale: 'en',
            },
          },
        ],
      },
      walletDID: WALLET,
      extensionsEnabled: false,
    })
    ok<Playlist>(r)
    const items = r.signedBytes.items as Array<Record<string, unknown>>
    expect(items[0]).not.toHaveProperty('inlineManifest')
    expect(r.wireBody).toEqual(r.signedBytes)
  })

  // This is the only place the envelope is checked, deliberately: an inline
  // manifest is never built by the form, it arrives by paste or import and
  // rides through form state untouched, so gating it in the JSON-tab parser
  // left the Form-tab publish path open.
  it('rejects an inlineManifest missing its envelope, naming every gap', () => {
    const r = preparePlaylistForPublish({
      rawDocument: {
        ...basePlaylist,
        items: [
          {
            source: 'https://example.com/a.html',
            inlineManifest: { refVersion: '0.1.0', id: 'ref-9d26ecb3' },
          },
        ],
      },
      walletDID: WALLET,
      extensionsEnabled: true,
    })
    expect(r).toHaveProperty('validationErrors')
    expect((r as { validationErrors: string[] }).validationErrors).toEqual([
      'items[0].inlineManifest is missing required Ref Manifest fields: created, locale.',
    ])
  })

  it('rejects a non-object inlineManifest', () => {
    const r = preparePlaylistForPublish({
      rawDocument: {
        ...basePlaylist,
        items: [
          {
            source: 'https://example.com/a.html',
            inlineManifest: 'https://example.com/manifest.json',
          },
        ],
      } as unknown as Playlist,
      walletDID: WALLET,
      extensionsEnabled: true,
    })
    expect((r as { validationErrors: string[] }).validationErrors).toEqual([
      'items[0].inlineManifest must be a Ref Manifest object.',
    ])
  })

  // The check runs on the strip's output, so with extensions off there is
  // nothing left to reject — the document publishes without the manifest
  // rather than failing over bytes we just discarded.
  it('ignores a malformed inlineManifest when extensions are off', () => {
    const r = preparePlaylistForPublish({
      rawDocument: {
        ...basePlaylist,
        items: [
          { source: 'https://example.com/a.html', inlineManifest: 'not an object' },
        ],
      } as unknown as Playlist,
      walletDID: WALLET,
      extensionsEnabled: false,
    })
    ok<Playlist>(r)
    const items = r.signedBytes.items as Array<Record<string, unknown>>
    expect(items[0]).not.toHaveProperty('inlineManifest')
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

  it('defaults dpVersion on create when omitted (JSON import no longer injects it)', () => {
    const { dpVersion: _d, ...raw } = basePlaylist
    const r = preparePlaylistForPublish({
      rawDocument: raw as Playlist,
      walletDID: WALLET,
      extensionsEnabled: true,
    })
    ok<Playlist>(r)
    expect(r.signedPayload.dpVersion).toBe('1.1.0')
    expect(r.signedBytes.dpVersion).toBe('1.1.0')
  })

  // Round-9 regression guards: wireBody is now derived from signedBytes (the
  // canonical hashing target), so create-mode wireBody MUST equal signedBytes
  // exactly. The previous round-8 fix added id/created but didn't catch the
  // parallel canonicalization in slug/version/blanks/entity-url paths.
  it('CREATE wireBody equals signedBytes exactly (full canonical parity)', () => {
    const r = preparePlaylistForPublish({
      rawDocument: {
        ...basePlaylist,
        id: 'pl-abc-123',
        created: '2026-05-22T08:30:00Z',
      },
      walletDID: WALLET,
      extensionsEnabled: true,
    })
    ok<Playlist>(r)
    expect(r.wireBody).toEqual(r.signedBytes)
  })

  // Under PATCH this omitted id and created: the id was in the URL and a partial update never restated
  // an immutable field. PUT replaces the whole document, and both are inside the signed payload, so
  // omitting either would both fail the feed's identity check and leave the delivered bytes different
  // from the signed ones.
  it('EDIT wireBody equals signedBytes exactly, including id and created', () => {
    const existing: Playlist = {
      ...basePlaylist,
      id: 'pl-abc-123',
      created: '2026-05-20T08:30:00Z',
    }
    const r = preparePlaylistForPublish({
      rawDocument: { ...basePlaylist, title: 'edited' },
      walletDID: WALLET,
      base: existing,
      extensionsEnabled: true,
    })
    ok<Playlist>(r)
    expect(r.signedBytes.id).toBe('pl-abc-123')
    expect(r.wireBody).toEqual(r.signedBytes)
    expect(r.wireBody.id).toBe('pl-abc-123')
    expect(r.wireBody.created).toBe(r.signedBytes.created)
  })

  it('drops unknown top-level fields imported from JSON (feed-contract whitelist)', () => {
    // The feed reconstructs a typed playlist via json.Marshal, which omits
    // any unknown fields. If we let `_buildMeta` or other tool metadata
    // through the canonicalizer, the feed would hash a different shape than
    // we signed — signature mismatch. The whitelist in
    // playlistUnsignedPayloadForSigning is the boundary that enforces this.
    const rawWithUnknown = {
      ...basePlaylist,
      id: 'pl-1',
      created: '2026-05-22T00:00:00Z',
      extraField: 'tool metadata that the feed does not know about',
      _buildTime: '2026-05-22T00:00:00Z',
    } as unknown as Playlist
    const r = preparePlaylistForPublish({
      rawDocument: rawWithUnknown,
      walletDID: WALLET,
      extensionsEnabled: true,
    })
    ok<Playlist>(r)
    // Unknown keys are absent from both signed bytes AND wire body —
    // i.e., the feed hashes the same shape we send.
    expect(r.signedBytes).not.toHaveProperty('extraField')
    expect(r.signedBytes).not.toHaveProperty('_buildTime')
    expect(r.wireBody).not.toHaveProperty('extraField')
    expect(r.wireBody).not.toHaveProperty('_buildTime')
    expect(r.wireBody).toEqual(r.signedBytes)
  })

  it('empty curators array is handled identically in signed and wire', () => {
    const r = preparePlaylistForPublish({
      rawDocument: {
        ...basePlaylist,
        id: 'pl-1',
        created: '2026-05-22T00:00:00Z',
        curators: [],
      },
      walletDID: WALLET,
      extensionsEnabled: true,
    })
    ok<Playlist>(r)
    expect(r.wireBody).toEqual(r.signedBytes)
  })

  it('blank summary / coverImage handled identically (stripped or kept) in signed and wire', () => {
    const r = preparePlaylistForPublish({
      rawDocument: {
        ...basePlaylist,
        id: 'pl-1',
        created: '2026-05-22T00:00:00Z',
        summary: '',
        coverImage: '',
      } as Playlist,
      walletDID: WALLET,
      extensionsEnabled: true,
    })
    ok<Playlist>(r)
    expect(r.wireBody).toEqual(r.signedBytes)
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
    // wireBody is exactly what was signed — a replace sends the whole document.
    expect(r.wireBody).toEqual(r.signedBytes)
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
    expect(r.toasts.some((t) => /curator/i.test(t.title))).toBe(false) // no curator injection happened
  })

  it('preserves existing dpVersion when patch omits it (JSON-tab edit regression)', () => {
    const existing: Playlist = { ...basePlaylist, dpVersion: '2.0.0' }
    const { dpVersion: _d, ...patchFields } = basePlaylist
    const r = preparePlaylistForPublish({
      rawDocument: { ...patchFields, title: 'edited' } as Playlist,
      walletDID: WALLET,
      base: existing,
      extensionsEnabled: true,
    })
    ok<Playlist>(r)
    expect(r.signedPayload.dpVersion).toBe('2.0.0')
    expect(r.signedBytes.dpVersion).toBe('2.0.0')
  })

  it('auto-fills a slug for a slugless playlist, surfaces it on signedPayload, and receipts it', () => {
    const { slug: _drop, ...noSlug } = {
      ...basePlaylist,
      // Real UUID → id[:8] is 8 clean hex chars (no intra-id hyphen).
      id: 'abcd1234-5678-90ab-cdef-1234567890ab',
      slug: undefined,
    }
    void _drop
    const r = preparePlaylistForPublish({
      rawDocument: noSlug as Playlist,
      walletDID: WALLET,
      extensionsEnabled: true,
    })
    ok<Playlist>(r)
    expect(r.signedBytes.slug).toBe('season-1-abcd1234')
    // The typed document the review renders from carries the resolved slug,
    // so the signer sees the final feed URL before signing.
    expect(r.signedPayload.slug).toBe('season-1-abcd1234')
    expect(r.wireBody.slug).toBe(r.signedBytes.slug)
    const slugToast = r.toasts.find((t) => /slug/i.test(t.title))
    expect(slugToast?.description).toContain('season-1-abcd1234')
  })

  it('does not receipt a slug when the author already provided one', () => {
    const r = preparePlaylistForPublish({
      rawDocument: { ...basePlaylist, slug: 'my-chosen-slug' },
      walletDID: WALLET,
      extensionsEnabled: true,
    })
    ok<Playlist>(r)
    expect(r.signedBytes.slug).toBe('my-chosen-slug')
    expect(r.toasts.some((t) => /slug/i.test(t.title))).toBe(false)
  })
})

// ----------------------------------------------------------------------------
// Channel
// ----------------------------------------------------------------------------

const baseChannel: Channel = {
  id: 'ch-base-0000',
  created: '2026-05-22T00:00:00Z',
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
    expect(r.wireBody.publisher).toEqual(r.signedBytes.publisher)
    expect(r.toasts).toHaveLength(0)
  })

  it('replaces did:key publisher key with wallet; wire matches signed bytes', () => {
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
    // Identity invariant: wire body equals signed bytes exactly on create.
    expect(r.wireBody).toEqual(r.signedBytes)
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
    // Edit-mode invariant: the wire body is exactly the signed bytes. Publisher specifically must match
    // (round-6 regression: signed payload and update body were built from different sources).
    expect(r.wireBody.publisher).toEqual(r.signedBytes.publisher)
    expect(r.wireBody).toEqual(r.signedBytes)
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

  it('preserves existing version when patch omits it (JSON-tab edit regression)', () => {
    const existing: Channel = { ...baseChannel, version: '2.0.0' }
    const { version: _v, ...patchFields } = baseChannel
    const r = prepareChannelForPublish({
      rawDocument: { ...patchFields, title: 'edited' } as Channel,
      walletDID: WALLET,
      base: existing,
    })
    ok<Channel>(r)
    expect(r.signedPayload.version).toBe('2.0.0')
    expect(r.signedBytes.version).toBe('2.0.0')
  })

  // Round-9 regression guards: full canonical parity. wireBody must equal
  // signedBytes exactly (on create) or signedBytes minus id+created (on
  // edit), with no parallel canonicalization paths producing drift.
  it('CREATE wireBody equals signedBytes exactly (full canonical parity)', () => {
    const r = prepareChannelForPublish({
      rawDocument: {
        ...baseChannel,
        id: 'ch-xyz-456',
        created: '2026-05-22T08:30:00Z',
      },
      walletDID: WALLET,
    })
    ok<Channel>(r)
    expect(r.wireBody).toEqual(r.signedBytes)
  })

  // See the playlist counterpart: PUT sends the whole signed document, id and created included.
  it('EDIT wireBody equals signedBytes exactly, including id and created', () => {
    const existing: Channel = {
      ...baseChannel,
      id: 'ch-xyz-456',
      created: '2026-05-20T08:30:00Z',
    }
    const r = prepareChannelForPublish({
      rawDocument: { ...baseChannel, title: 'edited' },
      walletDID: WALLET,
      base: existing,
    })
    ok<Channel>(r)
    expect(r.signedBytes.id).toBe('ch-xyz-456')
    expect(r.wireBody).toEqual(r.signedBytes)
    expect(r.wireBody.id).toBe('ch-xyz-456')
    expect(r.wireBody.created).toBe(r.signedBytes.created)
  })

  // Channel-specific cases the reviewer explicitly named. Each one was a
  // potential drift point where the previous hand-built wireBody could
  // diverge from what the canonicalizer produced.
  it('channel CREATE with no slug — auto-generated slug appears identically in signed and wire', () => {
    const r = prepareChannelForPublish({
      rawDocument: {
        ...baseChannel,
        slug: undefined,
        id: 'ch-1',
        created: '2026-05-22T00:00:00Z',
      },
      walletDID: WALLET,
    })
    ok<Channel>(r)
    expect(r.wireBody).toEqual(r.signedBytes)
    // And the auto-generated slug is actually present (not undefined).
    expect(typeof r.wireBody.slug).toBe('string')
    expect((r.wireBody.slug as string).length).toBeGreaterThan(0)
  })

  it('channel CREATE with blank version — defaulted version appears identically in signed and wire', () => {
    const r = prepareChannelForPublish({
      rawDocument: {
        ...baseChannel,
        version: '',
        id: 'ch-1',
        created: '2026-05-22T00:00:00Z',
      },
      walletDID: WALLET,
    })
    ok<Channel>(r)
    expect(r.wireBody).toEqual(r.signedBytes)
    expect(r.wireBody.version).toBe('1.0.0')
  })

  it('channel CREATE with blank summary/coverImage — stripped identically in signed and wire', () => {
    const r = prepareChannelForPublish({
      rawDocument: {
        ...baseChannel,
        summary: '',
        coverImage: '',
        id: 'ch-1',
        created: '2026-05-22T00:00:00Z',
      },
      walletDID: WALLET,
    })
    ok<Channel>(r)
    expect(r.wireBody).toEqual(r.signedBytes)
    expect(r.wireBody.summary).toBeUndefined()
    expect(r.wireBody.coverImage).toBeUndefined()
  })

  it('channel CREATE with empty entity url — normalized identically in signed and wire', () => {
    const r = prepareChannelForPublish({
      rawDocument: {
        ...baseChannel,
        publisher: { name: 'NODE', key: WALLET, url: '' },
        id: 'ch-1',
        created: '2026-05-22T00:00:00Z',
      },
      walletDID: WALLET,
    })
    ok<Channel>(r)
    expect(r.wireBody).toEqual(r.signedBytes)
    // entityWire drops empty url
    const pub = r.wireBody.publisher as { name: string; key: string; url?: string }
    expect(pub.url).toBeUndefined()
  })

  it('channel CREATE with empty curators array — handled identically in signed and wire', () => {
    const r = prepareChannelForPublish({
      rawDocument: {
        ...baseChannel,
        curators: [],
        id: 'ch-1',
        created: '2026-05-22T00:00:00Z',
      },
      walletDID: WALLET,
    })
    ok<Channel>(r)
    expect(r.wireBody).toEqual(r.signedBytes)
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
    expect(r.wireBody.publisher).toEqual(r.signedBytes.publisher)
  })

  it('returns validation errors for invalid playlist URI', () => {
    const originalEnv = { ...import.meta.env }
    delete (import.meta.env as Record<string, unknown>).VITE_DEBUG_MODE
    try {
      const r = prepareChannelForPublish({
        rawDocument: {
          ...baseChannel,
          playlists: ['http://example.com/insecure.json'],
        },
        walletDID: WALLET,
      })
      expect('validationErrors' in r).toBe(true)
      if ('validationErrors' in r) {
        expect(r.validationErrors.some((e) => /playlists\[0\]/i.test(e))).toBe(true)
      }
    } finally {
      ;(import.meta.env as Record<string, unknown>).VITE_DEBUG_MODE =
        originalEnv.VITE_DEBUG_MODE
    }
  })

  it('normalizes key-only channel curators before signing', () => {
    const r = prepareChannelForPublish({
      rawDocument: {
        ...baseChannel,
        curators: [{ key: WALLET } as Entity],
      },
      walletDID: WALLET,
    })
    ok<Channel>(r)
    expect(r.signedPayload.curators?.[0]).toEqual({
      name: '',
      key: WALLET,
      url: undefined,
    })
  })
})


