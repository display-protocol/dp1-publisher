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

  // Round-10 regression guard: imported JSON can carry tool metadata (build
  // times, debug fields, etc.). The feed reconstructs a typed Playlist via
  // json.Marshal, which silently omits unknown fields — so anything we let
  // through the canonicalizer would be hashed by us but not by the feed,
  // producing a signature mismatch on the JSON-import/re-sign path this PR
  // exists to fix.
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
