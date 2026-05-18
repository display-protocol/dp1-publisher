/**
 * Tests for playlist group sign payload builder
 * Ensures correct omitempty behavior matching dp1-feed-v2
 */

import { describe, it, expect } from 'vitest'
import { playlistGroupUnsignedPayloadForSigning } from '@/lib/playlistGroupSignPayload'
import { playlistGroupWithMetadata, minimalPlaylistGroup } from '@/test/fixtures/playlistGroup'
import type { PlaylistGroup } from '@/types/dp1'

describe('playlistGroupUnsignedPayloadForSigning', () => {
  it('should throw if id is missing', () => {
    const group: PlaylistGroup = {
      ...minimalPlaylistGroup,
      id: undefined,
    }
    expect(() => playlistGroupUnsignedPayloadForSigning(group)).toThrow(
      'Playlist group id and created are required for signing'
    )
  })

  it('should throw if created is missing', () => {
    const group: PlaylistGroup = {
      ...minimalPlaylistGroup,
      id: 'test-id',
      created: undefined,
    }
    expect(() => playlistGroupUnsignedPayloadForSigning(group)).toThrow(
      'Playlist group id and created are required for signing'
    )
  })

  it('should include required fields', () => {
    const group: PlaylistGroup = {
      ...minimalPlaylistGroup,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
    }
    const payload = playlistGroupUnsignedPayloadForSigning(group)
    expect(payload.id).toBe('test-id')
    expect(payload.created).toBe('2024-01-01T00:00:00Z')
    expect(payload).toHaveProperty('title')
    expect(payload).toHaveProperty('slug')
    expect(payload).toHaveProperty('playlists')
  })

  it('should omit empty curator', () => {
    const group: PlaylistGroup = {
      ...minimalPlaylistGroup,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
      curator: '',
    }
    const payload = playlistGroupUnsignedPayloadForSigning(group)
    expect(payload).not.toHaveProperty('curator')
  })

  it('should omit whitespace-only curator', () => {
    const group: PlaylistGroup = {
      ...minimalPlaylistGroup,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
      curator: '   ',
    }
    const payload = playlistGroupUnsignedPayloadForSigning(group)
    expect(payload).not.toHaveProperty('curator')
  })

  it('should include non-empty curator', () => {
    const group: PlaylistGroup = {
      ...minimalPlaylistGroup,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
      curator: 'did:pkh:eip155:1:0xcurator',
    }
    const payload = playlistGroupUnsignedPayloadForSigning(group)
    expect(payload.curator).toBe('did:pkh:eip155:1:0xcurator')
  })

  it('should omit empty summary', () => {
    const group: PlaylistGroup = {
      ...minimalPlaylistGroup,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
      summary: '',
    }
    const payload = playlistGroupUnsignedPayloadForSigning(group)
    expect(payload).not.toHaveProperty('summary')
  })

  it('should include non-empty summary', () => {
    const group: PlaylistGroup = {
      ...minimalPlaylistGroup,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
      summary: 'Test summary',
    }
    const payload = playlistGroupUnsignedPayloadForSigning(group)
    expect(payload.summary).toBe('Test summary')
  })

  it('should omit empty coverImage', () => {
    const group: PlaylistGroup = {
      ...minimalPlaylistGroup,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
      coverImage: '',
    }
    const payload = playlistGroupUnsignedPayloadForSigning(group)
    expect(payload).not.toHaveProperty('coverImage')
  })

  it('should include non-empty coverImage', () => {
    const group: PlaylistGroup = {
      ...minimalPlaylistGroup,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
      coverImage: 'https://example.com/cover.jpg',
    }
    const payload = playlistGroupUnsignedPayloadForSigning(group)
    expect(payload.coverImage).toBe('https://example.com/cover.jpg')
  })

  it('should generate slug correctly', () => {
    const group: PlaylistGroup = {
      ...minimalPlaylistGroup,
      id: 'test-id',
      title: 'My Group',
      slug: undefined,
      created: '2024-01-01T00:00:00Z',
    }
    const payload = playlistGroupUnsignedPayloadForSigning(group)
    expect(payload.slug).toBeDefined()
    expect(typeof payload.slug).toBe('string')
  })

  it('should use provided slug if available', () => {
    const group: PlaylistGroup = {
      ...minimalPlaylistGroup,
      id: 'test-id',
      slug: 'custom-slug',
      created: '2024-01-01T00:00:00Z',
    }
    const payload = playlistGroupUnsignedPayloadForSigning(group)
    expect(payload.slug).toBe('custom-slug')
  })

  it('should handle full metadata group', () => {
    const group: PlaylistGroup = {
      ...playlistGroupWithMetadata,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
    }
    const payload = playlistGroupUnsignedPayloadForSigning(group)
    expect(payload.title).toBe('Featured Groups')
    expect(payload.summary).toBe('A collection of featured playlists')
    expect(payload.coverImage).toBe('https://example.com/group-cover.jpg')
    expect(payload.curator).toBe('did:pkh:eip155:1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  })

  it('should produce JSON-serializable output', () => {
    const group: PlaylistGroup = {
      ...playlistGroupWithMetadata,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
    }
    const payload = playlistGroupUnsignedPayloadForSigning(group)
    expect(() => JSON.stringify(payload)).not.toThrow()
  })

  it('should clone playlists array', () => {
    const playlists = ['https://example.com/playlist1']
    const group: PlaylistGroup = {
      ...minimalPlaylistGroup,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
      playlists,
    }
    const payload = playlistGroupUnsignedPayloadForSigning(group)
    ;(payload.playlists as string[]).push('https://example.com/playlist2')
    expect(playlists.length).toBe(1)
  })

  it('should create isolated copy (no mutation)', () => {
    const original: PlaylistGroup = {
      ...playlistGroupWithMetadata,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
    }
    const payload = playlistGroupUnsignedPayloadForSigning(original)
    payload.title = 'Modified'
    expect(original.title).toBe('Featured Groups')
  })
})
