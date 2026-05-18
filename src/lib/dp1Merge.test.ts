/**
 * Tests for DP-1 merge helpers
 * Reusing patterns from dp1-js tests/merge/merge.test.ts
 * Tests PATCH semantics matching dp1-feed-v2 executor
 */

import { describe, it, expect } from 'vitest'
import {
  mergePlaylistForPatch,
  mergePlaylistGroupForPatch,
  mergeChannelForPatch,
} from '@/lib/dp1Merge'
import { playlistWithMetadata } from '@/test/fixtures/playlist'
import { channelWithMetadata } from '@/test/fixtures/channel'
import { playlistGroupWithMetadata } from '@/test/fixtures/playlistGroup'
import type { Playlist, Channel, PlaylistGroup } from '@/types/dp1'

describe('mergePlaylistForPatch', () => {
  it('should preserve existing values when patch is empty', () => {
    const existing = { ...playlistWithMetadata }
    const result = mergePlaylistForPatch(existing, {})
    expect(result).toEqual(existing)
  })

  it('should update title when provided', () => {
    const existing = { ...playlistWithMetadata }
    const result = mergePlaylistForPatch(existing, { title: 'New Title' })
    expect(result.title).toBe('New Title')
    expect(result.dpVersion).toBe(existing.dpVersion)
  })

  it('should update dpVersion when provided', () => {
    const existing = { ...playlistWithMetadata }
    const result = mergePlaylistForPatch(existing, { dpVersion: '1.2.0' })
    expect(result.dpVersion).toBe('1.2.0')
  })

  it('should update slug when provided', () => {
    const existing = { ...playlistWithMetadata }
    const result = mergePlaylistForPatch(existing, { slug: 'new-slug' })
    expect(result.slug).toBe('new-slug')
  })

  it('should replace items array when provided', () => {
    const existing = { ...playlistWithMetadata }
    const newItems = [{ source: 'https://example.com/new.png' }]
    const result = mergePlaylistForPatch(existing, { items: newItems })
    expect(result.items).toBe(newItems)
    expect(result.items.length).toBe(1)
  })

  it('should replace curators when provided', () => {
    const existing = { ...playlistWithMetadata }
    const newCurators = [{ name: 'Bob', key: 'did:pkh:eip155:1:0xbbb' }]
    const result = mergePlaylistForPatch(existing, { curators: newCurators })
    expect(result.curators).toBe(newCurators)
  })

  it('should allow setting summary to empty string', () => {
    const existing: Playlist = {
      ...playlistWithMetadata,
      summary: 'Old summary',
    }
    const result = mergePlaylistForPatch(existing, { summary: '' })
    expect(result.summary).toBe('')
  })

  it('should preserve existing summary when undefined in patch', () => {
    const existing: Playlist = {
      ...playlistWithMetadata,
      summary: 'Old summary',
    }
    const result = mergePlaylistForPatch(existing, {})
    expect(result.summary).toBe('Old summary')
  })

  it('should allow setting coverImage to empty string', () => {
    const existing: Playlist = {
      ...playlistWithMetadata,
      coverImage: 'https://old.com/cover.jpg',
    }
    const result = mergePlaylistForPatch(existing, { coverImage: '' })
    expect(result.coverImage).toBe('')
  })

  it('should preserve defaults when undefined in patch', () => {
    const existing: Playlist = {
      ...playlistWithMetadata,
      defaults: { display: { scaling: 'fit' } },
    }
    const result = mergePlaylistForPatch(existing, { defaults: undefined })
    expect(result.defaults).toEqual({ display: { scaling: 'fit' } })
  })

  it('should update defaults when provided', () => {
    const existing = { ...playlistWithMetadata }
    const newDefaults = { display: { scaling: 'fill' as const } }
    const result = mergePlaylistForPatch(existing, { defaults: newDefaults })
    expect(result.defaults).toBe(newDefaults)
  })

  it('should preserve dynamicQuery when undefined in patch', () => {
    const existing: Playlist = {
      ...playlistWithMetadata,
      dynamicQuery: {
        profile: 'https-json-v1',
        endpoint: 'https://api.example.com/items',
        responseMapping: {
          itemsPath: 'data.items',
          itemSchema: 'dp1/1.1',
        },
      },
    }
    const result = mergePlaylistForPatch(existing, { dynamicQuery: undefined })
    expect(result.dynamicQuery).toEqual({
      profile: 'https-json-v1',
      endpoint: 'https://api.example.com/items',
      responseMapping: {
        itemsPath: 'data.items',
        itemSchema: 'dp1/1.1',
      },
    })
  })

  it('should preserve note when undefined in patch', () => {
    const existing: Playlist = {
      ...playlistWithMetadata,
      note: { text: 'Old note', duration: 5 },
    }
    const result = mergePlaylistForPatch(existing, { note: undefined })
    expect(result.note).toEqual({ text: 'Old note', duration: 5 })
  })

  it('should update multiple fields at once', () => {
    const existing = { ...playlistWithMetadata }
    const result = mergePlaylistForPatch(existing, {
      title: 'New Title',
      summary: 'New Summary',
      coverImage: 'https://new.com/cover.jpg',
    })
    expect(result.title).toBe('New Title')
    expect(result.summary).toBe('New Summary')
    expect(result.coverImage).toBe('https://new.com/cover.jpg')
  })

  it('should not mutate the original playlist', () => {
    const existing = { ...playlistWithMetadata }
    const originalTitle = existing.title
    mergePlaylistForPatch(existing, { title: 'Modified' })
    expect(existing.title).toBe(originalTitle)
  })
})

describe('mergePlaylistGroupForPatch', () => {
  it('should preserve existing values when patch is empty', () => {
    const existing: PlaylistGroup = {
      ...playlistGroupWithMetadata,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
    }
    const result = mergePlaylistGroupForPatch(existing, {})
    expect(result).toEqual(existing)
  })

  it('should update title when provided', () => {
    const existing: PlaylistGroup = {
      ...playlistGroupWithMetadata,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
    }
    const result = mergePlaylistGroupForPatch(existing, { title: 'New Title' })
    expect(result.title).toBe('New Title')
  })

  it('should update slug when provided', () => {
    const existing: PlaylistGroup = {
      ...playlistGroupWithMetadata,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
    }
    const result = mergePlaylistGroupForPatch(existing, { slug: 'new-slug' })
    expect(result.slug).toBe('new-slug')
  })

  it('should replace playlists array when provided', () => {
    const existing: PlaylistGroup = {
      ...playlistGroupWithMetadata,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
    }
    const newPlaylists = ['https://example.com/new1', 'https://example.com/new2']
    const result = mergePlaylistGroupForPatch(existing, { playlists: newPlaylists })
    expect(result.playlists).toBe(newPlaylists)
  })

  it('should allow setting curator to empty string', () => {
    const existing: PlaylistGroup = {
      ...playlistGroupWithMetadata,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
      curator: 'did:pkh:eip155:1:0xold',
    }
    const result = mergePlaylistGroupForPatch(existing, { curator: '' })
    expect(result.curator).toBe('')
  })

  it('should allow setting summary to empty string', () => {
    const existing: PlaylistGroup = {
      ...playlistGroupWithMetadata,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
      summary: 'Old summary',
    }
    const result = mergePlaylistGroupForPatch(existing, { summary: '' })
    expect(result.summary).toBe('')
  })

  it('should allow setting coverImage to empty string', () => {
    const existing: PlaylistGroup = {
      ...playlistGroupWithMetadata,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
      coverImage: 'https://old.com/cover.jpg',
    }
    const result = mergePlaylistGroupForPatch(existing, { coverImage: '' })
    expect(result.coverImage).toBe('')
  })

  it('should not mutate the original group', () => {
    const existing: PlaylistGroup = {
      ...playlistGroupWithMetadata,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
    }
    const originalTitle = existing.title
    mergePlaylistGroupForPatch(existing, { title: 'Modified' })
    expect(existing.title).toBe(originalTitle)
  })
})

describe('mergeChannelForPatch', () => {
  it('should preserve existing values when patch is empty', () => {
    const existing: Channel = {
      ...channelWithMetadata,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
    }
    const result = mergeChannelForPatch(existing, {})
    expect(result).toEqual(existing)
  })

  it('should update title when provided', () => {
    const existing: Channel = {
      ...channelWithMetadata,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
    }
    const result = mergeChannelForPatch(existing, { title: 'New Title' })
    expect(result.title).toBe('New Title')
  })

  it('should update version when provided', () => {
    const existing: Channel = {
      ...channelWithMetadata,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
    }
    const result = mergeChannelForPatch(existing, { version: '2.0.0' })
    expect(result.version).toBe('2.0.0')
  })

  it('should replace playlists array when provided', () => {
    const existing: Channel = {
      ...channelWithMetadata,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
    }
    const newPlaylists = ['https://example.com/new1']
    const result = mergeChannelForPatch(existing, { playlists: newPlaylists })
    expect(result.playlists).toBe(newPlaylists)
  })

  it('should preserve curators when undefined in patch', () => {
    const existing: Channel = {
      ...channelWithMetadata,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
      curators: [{ name: 'Alice', key: 'did:pkh:eip155:1:0xaaa' }],
    }
    const result = mergeChannelForPatch(existing, { curators: undefined })
    expect(result.curators).toEqual([{ name: 'Alice', key: 'did:pkh:eip155:1:0xaaa' }])
  })

  it('should replace curators when provided', () => {
    const existing: Channel = {
      ...channelWithMetadata,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
    }
    const newCurators = [{ name: 'Bob', key: 'did:pkh:eip155:1:0xbbb' }]
    const result = mergeChannelForPatch(existing, { curators: newCurators })
    expect(result.curators).toBe(newCurators)
  })

  it('should preserve publisher when undefined in patch', () => {
    const existing: Channel = {
      ...channelWithMetadata,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
      publisher: { name: 'Old Publisher', key: 'did:pkh:eip155:1:0xold' },
    }
    const result = mergeChannelForPatch(existing, { publisher: undefined })
    expect(result.publisher).toEqual({ name: 'Old Publisher', key: 'did:pkh:eip155:1:0xold' })
  })

  it('should replace publisher when provided', () => {
    const existing: Channel = {
      ...channelWithMetadata,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
    }
    const newPublisher = { name: 'New Publisher', key: 'did:pkh:eip155:1:0xnew' }
    const result = mergeChannelForPatch(existing, { publisher: newPublisher })
    expect(result.publisher).toBe(newPublisher)
  })

  it('should allow setting summary to empty string', () => {
    const existing: Channel = {
      ...channelWithMetadata,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
      summary: 'Old summary',
    }
    const result = mergeChannelForPatch(existing, { summary: '' })
    expect(result.summary).toBe('')
  })

  it('should allow setting coverImage to empty string', () => {
    const existing: Channel = {
      ...channelWithMetadata,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
      coverImage: 'https://old.com/cover.jpg',
    }
    const result = mergeChannelForPatch(existing, { coverImage: '' })
    expect(result.coverImage).toBe('')
  })

  it('should update multiple fields at once', () => {
    const existing: Channel = {
      ...channelWithMetadata,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
    }
    const result = mergeChannelForPatch(existing, {
      title: 'New Title',
      version: '2.0.0',
      summary: 'New Summary',
    })
    expect(result.title).toBe('New Title')
    expect(result.version).toBe('2.0.0')
    expect(result.summary).toBe('New Summary')
  })

  it('should not mutate the original channel', () => {
    const existing: Channel = {
      ...channelWithMetadata,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
    }
    const originalTitle = existing.title
    mergeChannelForPatch(existing, { title: 'Modified' })
    expect(existing.title).toBe(originalTitle)
  })
})

describe('merge helpers - undefined vs null semantics', () => {
  it('playlist: undefined in patch preserves existing, explicit value replaces', () => {
    const existing: Playlist = {
      ...playlistWithMetadata,
      summary: 'Original',
    }
    const withUndefined = mergePlaylistForPatch(existing, { summary: undefined })
    expect(withUndefined.summary).toBe('Original')

    const withEmpty = mergePlaylistForPatch(existing, { summary: '' })
    expect(withEmpty.summary).toBe('')
  })

  it('playlistGroup: undefined in patch preserves existing, explicit value replaces', () => {
    const existing: PlaylistGroup = {
      ...playlistGroupWithMetadata,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
      summary: 'Original',
    }
    const withUndefined = mergePlaylistGroupForPatch(existing, { summary: undefined })
    expect(withUndefined.summary).toBe('Original')

    const withEmpty = mergePlaylistGroupForPatch(existing, { summary: '' })
    expect(withEmpty.summary).toBe('')
  })

  it('channel: undefined in patch preserves existing, explicit value replaces', () => {
    const existing: Channel = {
      ...channelWithMetadata,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
      summary: 'Original',
    }
    const withUndefined = mergeChannelForPatch(existing, { summary: undefined })
    expect(withUndefined.summary).toBe('Original')

    const withEmpty = mergeChannelForPatch(existing, { summary: '' })
    expect(withEmpty.summary).toBe('')
  })
})
