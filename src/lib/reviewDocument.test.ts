/**
 * Tests for the review-and-sign parse/describe layer.
 * Kind detection must never guess; validation must match the forms' JSON-tab
 * strictness; summaries must state role and post-signing mutability.
 */

import { describe, it, expect } from 'vitest'
import {
  describeReviewDocument,
  parseReviewDocument,
  hasUnnamedWalletEntity,
} from '@/lib/reviewDocument'
import { minimalPlaylist } from '@/test/fixtures/playlist'
import { minimalChannel } from '@/test/fixtures/channel'
import type { Playlist } from '@/types/dp1'

const EXT = { extensionsEnabled: true }
const NO_EXT = { extensionsEnabled: false }

function parseOk(text: string, opts = EXT) {
  const r = parseReviewDocument(text, opts)
  if ('error' in r) throw new Error(`Expected parse to succeed, got: ${r.error}`)
  return r.doc
}

describe('parseReviewDocument — detection', () => {
  it('detects a playlist by items[]', () => {
    const doc = parseOk(JSON.stringify(minimalPlaylist))
    expect(doc.kind).toBe('playlist')
  })

  it('detects a channel by playlists[] + version', () => {
    const doc = parseOk(JSON.stringify(minimalChannel))
    expect(doc.kind).toBe('channel')
  })

  it('detects a channel by playlists[] + publisher (no version)', () => {
    const { version: _v, ...noVersion } = {
      ...minimalChannel,
      publisher: { name: 'Gallery', key: 'did:pkh:eip155:1:0xabc' },
    }
    const doc = parseOk(JSON.stringify(noVersion))
    expect(doc.kind).toBe('channel')
  })

  // Groups were removed, so `playlists[]` has exactly one reading now. A
  // channel missing version/publisher/curators is a degenerate channel, and
  // channel validation reports the missing field rather than guessing a kind.
  it('detects a channel by playlists[] with no other markers', () => {
    const { version: _v, ...bare } = minimalChannel
    const doc = parseOk(JSON.stringify(bare))
    expect(doc.kind).toBe('channel')
  })

  it('rejects a document with both items and playlists', () => {
    const r = parseReviewDocument(
      JSON.stringify({ title: 'x', items: [], playlists: [] }),
      EXT
    )
    expect(r).toHaveProperty('error')
    expect((r as { error: string }).error).toMatch(/both/)
  })

  it('rejects a document with neither items nor playlists', () => {
    const r = parseReviewDocument(JSON.stringify({ title: 'x' }), EXT)
    expect(r).toHaveProperty('error')
    expect((r as { error: string }).error).toMatch(/Not a recognizable/)
  })

  it('rejects non-JSON and non-object inputs', () => {
    expect(parseReviewDocument('not json', EXT)).toHaveProperty('error')
    expect(parseReviewDocument('[1,2]', EXT)).toHaveProperty('error')
    expect(parseReviewDocument('null', EXT)).toHaveProperty('error')
  })
})

describe('parseReviewDocument — validation', () => {
  it('requires a title', () => {
    const r = parseReviewDocument(
      JSON.stringify({ ...minimalPlaylist, title: '  ' }),
      EXT
    )
    expect(r).toHaveProperty('error')
  })

  it('requires item sources on playlists', () => {
    const r = parseReviewDocument(
      JSON.stringify({ ...minimalPlaylist, items: [{ title: 'no source' }] }),
      EXT
    )
    expect((r as { error: string }).error).toMatch(/items\[0\]\.source/)
  })

  it('rejects disallowed item source URIs (same policy as the forms)', () => {
    const r = parseReviewDocument(
      JSON.stringify({
        ...minimalPlaylist,
        items: [{ source: 'javascript:alert(1)' }],
      }),
      EXT
    )
    expect(r).toHaveProperty('error')
  })

  it('rejects channels when extensions are off', () => {
    const r = parseReviewDocument(JSON.stringify(minimalChannel), NO_EXT)
    expect((r as { error: string }).error).toMatch(/extensions are off/)
  })

  it('rejects dynamicQuery playlists when extensions are off', () => {
    const r = parseReviewDocument(
      JSON.stringify({
        ...minimalPlaylist,
        dynamicQuery: { profile: 'https-json-v1', endpoint: 'https://x.example' },
      }),
      NO_EXT
    )
    expect((r as { error: string }).error).toMatch(/dynamicQuery/)
  })

  // §3.6 inline manifests pass through this parser untouched — they are
  // checked in preparePublish, the one chokepoint every entry path shares
  // (see preparePublish.test.ts). This page must not reject them on its own.
  it('carries an item inlineManifest through to the parsed document', () => {
    const inlineManifest = {
      refVersion: '0.1.0',
      id: 'ref-9d26ecb3',
      created: '2026-07-28T00:00:00Z',
      locale: 'en',
    }
    const doc = parseOk(
      JSON.stringify({
        ...minimalPlaylist,
        items: [{ source: 'https://example.com/a.html', inlineManifest }],
      })
    )
    expect(doc.kind).toBe('playlist')
    const items = (doc.document as Playlist).items
    expect(items[0].inlineManifest).toEqual(inlineManifest)
  })

  it('requires at least one playlist URI on channels and groups', () => {
    const ch = parseReviewDocument(
      JSON.stringify({ ...minimalChannel, playlists: [] }),
      EXT
    )
    expect(ch).toHaveProperty('error')
  })
})

describe('parseReviewDocument — normalization', () => {
  it('strips prior signatures and defaults id/created', () => {
    const doc = parseOk(
      JSON.stringify({
        ...minimalPlaylist,
        signatures: [
          {
            alg: 'ed25519',
            kid: 'did:key:z6Mk',
            ts: '2026-01-01T00:00:00Z',
            payload_hash: 'sha256:abc',
            role: 'agent',
            sig: 'sig',
          },
        ],
      })
    )
    expect(doc.document).not.toHaveProperty('signatures')
    expect(doc.document.id).toBeTruthy()
    expect(doc.document.created).toBeTruthy()
  })

  it('preserves an existing id (overwrite preflight depends on it)', () => {
    const doc = parseOk(
      JSON.stringify({ ...minimalPlaylist, id: '385f79b6-a45f-4c1c-8080-e93a192adccc' })
    )
    expect(doc.document.id).toBe('385f79b6-a45f-4c1c-8080-e93a192adccc')
  })

  it('trims playlist URIs on channels', () => {
    const doc = parseOk(
      JSON.stringify({
        ...minimalChannel,
        playlists: ['  https://feed.example/playlists/1  '],
      })
    )
    expect((doc.document as { playlists: string[] }).playlists).toEqual([
      'https://feed.example/playlists/1',
    ])
  })
})

describe('describeReviewDocument', () => {
  it('describes a playlist with curator role and item count', () => {
    const doc = parseOk(JSON.stringify(minimalPlaylist))
    const summary = describeReviewDocument(doc)
    expect(summary.kindLabel).toBe('Playlist')
    expect(summary.role).toBe('curator')
    expect(summary.facts.join(' ')).toMatch(/1 artwork/)
    expect(summary.covers.join(' ')).toMatch(/curator/)
  })

  it('describes a channel with publisher role and non-transitive coverage', () => {
    const doc = parseOk(JSON.stringify(minimalChannel))
    const summary = describeReviewDocument(doc)
    expect(summary.kindLabel).toBe('Channel')
    expect(summary.role).toBe('publisher')
    // The heart of issue #10: the summary must say linked playlists can
    // change without re-approval (channels ext §5.1 — no transitive cover).
    expect(summary.canChangeAfter.join(' ')).toMatch(/without your re-approval/)
    expect(summary.covers.join(' ')).toMatch(/NOT cover/)
  })

  it('flags dynamic playlists as content that can differ from the listing', () => {
    const doc = parseOk(
      JSON.stringify({
        ...minimalPlaylist,
        dynamicQuery: {
          profile: 'https-json-v1',
          endpoint: 'https://api.example/items',
          responseMapping: { itemsPath: 'data', itemSchema: 'dp1/1.1' },
        },
      })
    )
    const summary = describeReviewDocument(doc)
    expect(summary.facts.join(' ')).toMatch(/loaded live/)
  })

  it('surfaces content hosts', () => {
    const doc = parseOk(JSON.stringify(minimalPlaylist))
    const summary = describeReviewDocument(doc)
    expect(summary.facts.join(' ')).toMatch(/example\.com/)
  })
})

describe('hasUnnamedWalletEntity', () => {
  const WALLET = 'did:pkh:eip155:1:0x9E4e4c30B92D4109442215027279Fdaed45a620f'

  it('flags a playlist whose wallet curator has an empty name', () => {
    expect(
      hasUnnamedWalletEntity(
        {
          kind: 'playlist',
          document: { ...minimalPlaylist, curators: [{ name: '', key: WALLET }] },
        },
        WALLET
      )
    ).toBe(true)
  })

  it('does not flag when the wallet curator is named', () => {
    expect(
      hasUnnamedWalletEntity(
        {
          kind: 'playlist',
          document: {
            ...minimalPlaylist,
            curators: [{ name: 'Sean Moss-Pultz', key: WALLET }],
          },
        },
        WALLET
      )
    ).toBe(false)
  })

  it('ignores unnamed entities belonging to other wallets', () => {
    expect(
      hasUnnamedWalletEntity(
        {
          kind: 'playlist',
          document: {
            ...minimalPlaylist,
            curators: [{ name: '', key: 'did:pkh:eip155:1:0x0000000000000000000000000000000000000001' }],
          },
        },
        WALLET
      )
    ).toBe(false)
  })

  it('checks the channel publisher slot too', () => {
    expect(
      hasUnnamedWalletEntity(
        {
          kind: 'channel',
          document: { ...minimalChannel, publisher: { name: '  ', key: WALLET } },
        },
        WALLET
      )
    ).toBe(true)
  })
})
