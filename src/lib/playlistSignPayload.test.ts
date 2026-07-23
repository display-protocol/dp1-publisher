/**
 * Tests for playlist sign payload builder
 * Ensures correct omitempty behavior matching dp1-feed-v2
 */

import { describe, it, expect } from 'vitest'
import { playlistUnsignedPayloadForSigning } from '@/lib/playlistSignPayload'
import { minimalPlaylist, playlistWithMetadata } from '@/test/fixtures/playlist'
import type { Playlist } from '@/types/dp1'

describe('playlistUnsignedPayloadForSigning', () => {
  it('should include all required fields', () => {
    const payload = playlistUnsignedPayloadForSigning(minimalPlaylist)
    expect(payload).toHaveProperty('dpVersion')
    expect(payload).toHaveProperty('title')
    expect(payload).toHaveProperty('items')
  })

  // Round-10/11 regression guards: imported JSON can carry tool metadata
  // at any nesting level. The feed reconstructs a typed Playlist via
  // json.Marshal, which silently omits unknown fields top-level AND nested
  // — so anything we let through the canonicalizer would be hashed by us
  // but not by the feed, producing a signature mismatch on the JSON-import/
  // re-sign path this PR exists to fix.
  it('drops unknown top-level fields (feed-contract whitelist)', () => {
    const playlist = {
      ...minimalPlaylist,
      extraField: 'tool metadata',
      _buildTime: '2026-05-22T00:00:00Z',
      __debug: { something: true },
    } as unknown as Playlist
    const payload = playlistUnsignedPayloadForSigning(playlist)
    expect(payload).not.toHaveProperty('extraField')
    expect(payload).not.toHaveProperty('_buildTime')
    expect(payload).not.toHaveProperty('__debug')
    // But typed fields still survive.
    expect(payload).toHaveProperty('dpVersion')
    expect(payload).toHaveProperty('title')
    expect(payload).toHaveProperty('items')
  })

  it('drops unknown fields inside items[i] (the round-11 finding)', () => {
    const playlist = {
      ...minimalPlaylist,
      items: [
        {
          source: 'https://example.com/v.m3u8',
          title: 'Item with tool metadata',
          _buildMeta: { stale: true },
          customTag: 'should-not-survive',
        },
      ],
    } as unknown as Playlist
    const payload = playlistUnsignedPayloadForSigning(playlist)
    const items = payload.items as Array<Record<string, unknown>>
    expect(items[0]).not.toHaveProperty('_buildMeta')
    expect(items[0]).not.toHaveProperty('customTag')
    expect(items[0]).toHaveProperty('source')
    expect(items[0]).toHaveProperty('title')
  })

  it('drops unknown fields inside items[i].display (nested DisplayPrefs)', () => {
    const playlist = {
      ...minimalPlaylist,
      items: [
        {
          source: 'https://example.com/v.m3u8',
          display: {
            scaling: 'fit',
            customDisplayHint: 'ignore-me',
            __debug: true,
          },
        },
      ],
    } as unknown as Playlist
    const payload = playlistUnsignedPayloadForSigning(playlist)
    const display = (payload.items as Array<{ display: Record<string, unknown> }>)[0].display
    expect(display).not.toHaveProperty('customDisplayHint')
    expect(display).not.toHaveProperty('__debug')
    expect(display.scaling).toBe('fit')
  })

  // Issue #4 regression guards: whitelisting must reach every typed nesting
  // level, not stop at the first. These shapes were the remaining gaps after
  // PR #2's top-level and first-level passes. Expected bytes mirror dp1-go's
  // typed marshal exactly (value-typed `omitempty` fields drop "", false, and
  // empty slices) — the feed re-marshals before verifying, so anything else
  // is a guaranteed signature failure, not a style choice.
  it('drops unknown fields inside items[i].display.interaction.mouse (issue #4)', () => {
    const playlist = {
      ...minimalPlaylist,
      items: [
        {
          source: 'https://example.com/v.m3u8',
          display: {
            interaction: {
              keyboard: ['KeyW'],
              mouse: { click: true, drag: false, extra: 'x' },
            },
          },
        },
      ],
    } as unknown as Playlist
    const payload = playlistUnsignedPayloadForSigning(playlist)
    const display = (payload.items as Array<{ display: Record<string, unknown> }>)[0].display
    const interaction = display.interaction as Record<string, unknown>
    const mouse = interaction.mouse as Record<string, unknown>
    expect(mouse).not.toHaveProperty('extra')
    expect(mouse.click).toBe(true)
    // MousePrefs bools are value-typed omitempty in dp1-go: `false` is absent
    // from the feed's re-marshal and must be absent from the signed bytes.
    expect(mouse).not.toHaveProperty('drag')
    expect(interaction.keyboard).toEqual(['KeyW'])
  })

  it('re-marshals an all-false mouse as {} and drops an empty keyboard array (Go omitempty)', () => {
    const playlist = {
      ...minimalPlaylist,
      items: [
        {
          source: 'https://example.com/v.m3u8',
          display: {
            interaction: { keyboard: [], mouse: { click: false, hover: false } },
          },
        },
      ],
    } as unknown as Playlist
    const payload = playlistUnsignedPayloadForSigning(playlist)
    const display = (payload.items as Array<{ display: Record<string, unknown> }>)[0].display
    const interaction = display.interaction as Record<string, unknown>
    // `[]string omitempty` → empty keyboard is gone entirely.
    expect(interaction).not.toHaveProperty('keyboard')
    // Mouse pointer is non-nil on the feed side → `{}` survives, empty.
    expect(interaction.mouse).toEqual({})
  })

  it('passes engineVersion through as an open dictionary and whitelists frameHash (issue #4)', () => {
    const playlist = {
      ...minimalPlaylist,
      items: [
        {
          source: 'https://example.com/v.m3u8',
          repro: {
            engineVersion: { chromium: '131.0', servo: '0.9' },
            seed: '0xabc',
            frameHash: { sha256: 'a'.repeat(64), tool: 'capture-bot', phash: '' },
          },
        },
      ],
    } as unknown as Playlist
    const payload = playlistUnsignedPayloadForSigning(playlist)
    const repro = (payload.items as Array<{ repro: Record<string, unknown> }>)[0].repro
    // ReproBlock.EngineVersion is map[string]string — an intentional open
    // dictionary: arbitrary engine names must survive verbatim.
    expect(repro.engineVersion).toEqual({ chromium: '131.0', servo: '0.9' })
    const frameHash = repro.frameHash as Record<string, unknown>
    expect(frameHash).not.toHaveProperty('tool')
    // `string omitempty` → empty phash is dropped from the signed bytes.
    expect(frameHash).not.toHaveProperty('phash')
    expect(frameHash.sha256).toBe('a'.repeat(64))
    expect(repro.seed).toBe('0xabc')
  })

  it('drops empty-map engineVersion, empty seed, and empty assetsSHA256 (Go omitempty)', () => {
    const playlist = {
      ...minimalPlaylist,
      items: [
        {
          source: 'https://example.com/v.m3u8',
          repro: { engineVersion: {}, seed: '', assetsSHA256: [] },
        },
      ],
    } as unknown as Playlist
    const payload = playlistUnsignedPayloadForSigning(playlist)
    const repro = (payload.items as Array<{ repro: Record<string, unknown> }>)[0].repro
    expect(repro).not.toHaveProperty('engineVersion')
    expect(repro).not.toHaveProperty('seed')
    expect(repro).not.toHaveProperty('assetsSHA256')
  })

  it('drops unknown fields inside items[i].provenance.dependencies[] (issue #4)', () => {
    const playlist = {
      ...minimalPlaylist,
      items: [
        {
          source: 'https://example.com/v.m3u8',
          provenance: {
            type: 'onChain',
            contract: { chain: 'evm', address: '0x1' },
            dependencies: [
              {
                chain: 'evm',
                standard: 'erc721',
                uri: 'https://dep.example',
                extra: 'y',
                // `string omitempty` on ProvenanceDep fields → empty strings
                // must not reach the signed bytes.
              },
              { chain: '', standard: 'fa2', uri: '' },
              'not-an-object',
            ],
          },
        },
      ],
    } as unknown as Playlist
    const payload = playlistUnsignedPayloadForSigning(playlist)
    const prov = (payload.items as Array<{ provenance: Record<string, unknown> }>)[0]
      .provenance
    const deps = prov.dependencies as Array<Record<string, unknown>>
    expect(deps).toHaveLength(2)
    expect(deps[0]).not.toHaveProperty('extra')
    expect(deps[0]).toEqual({
      chain: 'evm',
      standard: 'erc721',
      uri: 'https://dep.example',
    })
    expect(deps[1]).toEqual({ standard: 'fa2' })
  })

  it('drops an empty dependencies array entirely ([]ProvenanceDep omitempty)', () => {
    const playlist = {
      ...minimalPlaylist,
      items: [
        {
          source: 'https://example.com/v.m3u8',
          provenance: { type: 'offChainURI', dependencies: [] },
        },
      ],
    } as unknown as Playlist
    const payload = playlistUnsignedPayloadForSigning(playlist)
    const prov = (payload.items as Array<{ provenance: Record<string, unknown> }>)[0]
      .provenance
    expect(prov).not.toHaveProperty('dependencies')
  })

  it('drops unknown fields inside defaults and defaults.display', () => {
    const playlist = {
      ...minimalPlaylist,
      defaults: {
        display: { scaling: 'fit', extraDisplay: 'nope' },
        license: 'open',
        unknownTopInDefaults: 42,
      },
    } as unknown as Playlist
    const payload = playlistUnsignedPayloadForSigning(playlist)
    const defaults = payload.defaults as Record<string, unknown>
    expect(defaults).not.toHaveProperty('unknownTopInDefaults')
    expect(defaults).toHaveProperty('license')
    const display = defaults.display as Record<string, unknown>
    expect(display).not.toHaveProperty('extraDisplay')
    expect(display.scaling).toBe('fit')
  })

  // Documented intentional open dictionaries — these are typed as
  // `Record<string, …>` in dp1.ts, so arbitrary keys are *part of the
  // contract*. They must survive verbatim through the canonicalizer.
  it('preserves arbitrary keys inside intentional open dictionaries (override, userOverrides, headers)', () => {
    const playlist = {
      ...minimalPlaylist,
      items: [
        {
          source: 'https://example.com/v.m3u8',
          override: { customRendererKey: 'value', anotherKey: 42 },
          display: {
            scaling: 'fit',
            userOverrides: { background: true, scaling: false },
          },
        },
      ],
      dynamicQuery: {
        profile: 'https-json-v1',
        endpoint: 'https://example.com/api',
        headers: { Authorization: 'Bearer token', 'X-Custom': 'value' },
        responseMapping: { itemsPath: 'data', itemSchema: 'dp1/1.1' },
      },
    } as unknown as Playlist
    const payload = playlistUnsignedPayloadForSigning(playlist)
    const item = (payload.items as Array<Record<string, unknown>>)[0]
    // override: open dictionary → arbitrary keys survive verbatim
    expect(item.override).toEqual({ customRendererKey: 'value', anotherKey: 42 })
    // userOverrides: open dictionary inside DisplayPrefs → arbitrary keys survive
    const display = item.display as Record<string, unknown>
    expect(display.userOverrides).toEqual({ background: true, scaling: false })
    // headers: open dictionary inside DynamicQuery → arbitrary keys survive
    const dq = payload.dynamicQuery as Record<string, unknown>
    expect(dq.headers).toEqual({ Authorization: 'Bearer token', 'X-Custom': 'value' })
  })

  it('drops unknown fields inside dynamicQuery and dynamicQuery.responseMapping', () => {
    const playlist = {
      ...minimalPlaylist,
      dynamicQuery: {
        profile: 'https-json-v1',
        endpoint: 'https://example.com/api',
        responseMapping: {
          itemsPath: 'data',
          itemSchema: 'dp1/1.1',
          extraInRM: 'remove me',
        },
        extraInDQ: 'remove me too',
      },
    } as unknown as Playlist
    const payload = playlistUnsignedPayloadForSigning(playlist)
    const dq = payload.dynamicQuery as Record<string, unknown>
    expect(dq).not.toHaveProperty('extraInDQ')
    expect(dq.profile).toBe('https-json-v1')
    const rm = dq.responseMapping as Record<string, unknown>
    expect(rm).not.toHaveProperty('extraInRM')
    expect(rm.itemsPath).toBe('data')
  })

  it('should strip signatures array', () => {
    const playlist: Playlist = {
      ...minimalPlaylist,
      signatures: [
        {
          alg: 'eip191',
          kid: 'did:pkh:eip155:1:0x1234',
          ts: '2024-01-01T00:00:00Z',
          payload_hash: 'sha256:test',
          role: 'curator',
          sig: 'test-sig',
        },
      ],
    }
    const payload = playlistUnsignedPayloadForSigning(playlist)
    expect(payload).not.toHaveProperty('signatures')
  })

  it('should omit empty summary', () => {
    const playlist: Playlist = {
      ...minimalPlaylist,
      summary: '',
    }
    const payload = playlistUnsignedPayloadForSigning(playlist)
    expect(payload).not.toHaveProperty('summary')
  })

  it('should omit whitespace-only summary', () => {
    const playlist: Playlist = {
      ...minimalPlaylist,
      summary: '   ',
    }
    const payload = playlistUnsignedPayloadForSigning(playlist)
    expect(payload).not.toHaveProperty('summary')
  })

  it('should include non-empty summary', () => {
    const playlist: Playlist = {
      ...minimalPlaylist,
      summary: 'Test summary',
    }
    const payload = playlistUnsignedPayloadForSigning(playlist)
    expect(payload.summary).toBe('Test summary')
  })

  it('should omit empty coverImage', () => {
    const playlist: Playlist = {
      ...minimalPlaylist,
      coverImage: '',
    }
    const payload = playlistUnsignedPayloadForSigning(playlist)
    expect(payload).not.toHaveProperty('coverImage')
  })

  it('should include non-empty coverImage', () => {
    const playlist: Playlist = {
      ...minimalPlaylist,
      coverImage: 'https://example.com/cover.jpg',
    }
    const payload = playlistUnsignedPayloadForSigning(playlist)
    expect(payload.coverImage).toBe('https://example.com/cover.jpg')
  })

  it('should omit empty curators array', () => {
    const playlist: Playlist = {
      ...minimalPlaylist,
      curators: [],
    }
    const payload = playlistUnsignedPayloadForSigning(playlist)
    expect(payload).not.toHaveProperty('curators')
  })

  it('should omit undefined curators', () => {
    const payload = playlistUnsignedPayloadForSigning(minimalPlaylist)
    expect(payload).not.toHaveProperty('curators')
  })

  it('should include non-empty curators with entity wire format', () => {
    const payload = playlistUnsignedPayloadForSigning(playlistWithMetadata)
    expect(payload.curators).toBeDefined()
    expect(Array.isArray(payload.curators)).toBe(true)
    const curators = payload.curators as Array<{ name: string; key: string; url?: string }>
    expect(curators[0]).toHaveProperty('name')
    expect(curators[0]).toHaveProperty('key')
    // url should be omitted if empty in entityWire
  })

  it('should apply entityWire to each curator', () => {
    const playlist: Playlist = {
      ...minimalPlaylist,
      curators: [
        { name: 'Alice', key: 'did:pkh:eip155:1:0xaaa', url: 'https://alice.com' },
        { name: 'Bob', key: 'did:pkh:eip155:1:0xbbb', url: '' },
      ],
    }
    const payload = playlistUnsignedPayloadForSigning(playlist)
    const curators = payload.curators as Array<{ name: string; key: string; url?: string }>
    expect(curators[0].url).toBe('https://alice.com')
    expect(curators[1]).not.toHaveProperty('url')
  })

  it('should produce JSON-serializable output', () => {
    const payload = playlistUnsignedPayloadForSigning(playlistWithMetadata)
    expect(() => JSON.stringify(payload)).not.toThrow()
  })

  it('should handle full metadata playlist', () => {
    const payload = playlistUnsignedPayloadForSigning(playlistWithMetadata)
    expect(payload.dpVersion).toBe('1.1.0')
    expect(payload.title).toBe('Featured Collection')
    expect(payload.summary).toBe('A curated collection of digital art')
    expect(payload.coverImage).toBe('https://example.com/cover.jpg')
    expect(Array.isArray(payload.items)).toBe(true)
  })

  it('should create isolated copy (no mutation)', () => {
    const original = { ...playlistWithMetadata }
    const payload = playlistUnsignedPayloadForSigning(original)
    payload.title = 'Modified'
    expect(original.title).toBe('Featured Collection')
  })
})
