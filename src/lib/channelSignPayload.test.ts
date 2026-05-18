/**
 * Tests for channel sign payload builder
 * Ensures correct omitempty behavior matching dp1-feed-v2
 */

import { describe, it, expect } from 'vitest'
import { channelUnsignedPayloadForSigning } from '@/lib/channelSignPayload'
import { channelWithMetadata, minimalChannel } from '@/test/fixtures/channel'
import type { Channel } from '@/types/dp1'

describe('channelUnsignedPayloadForSigning', () => {
  it('should throw if id is missing', () => {
    const channel: Channel = {
      ...minimalChannel,
      id: undefined,
    }
    expect(() => channelUnsignedPayloadForSigning(channel)).toThrow(
      'Channel id and created are required for signing'
    )
  })

  it('should throw if created is missing', () => {
    const channel: Channel = {
      ...minimalChannel,
      id: 'test-id',
      created: '',
    }
    expect(() => channelUnsignedPayloadForSigning(channel)).toThrow(
      'Channel id and created are required for signing'
    )
  })

  it('should include required fields', () => {
    const channel: Channel = {
      ...minimalChannel,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
    }
    const payload = channelUnsignedPayloadForSigning(channel)
    expect(payload.id).toBe('test-id')
    expect(payload.created).toBe('2024-01-01T00:00:00Z')
    expect(payload).toHaveProperty('title')
    expect(payload).toHaveProperty('slug')
    expect(payload).toHaveProperty('version')
    expect(payload).toHaveProperty('playlists')
  })

  it('should use default version if not provided', () => {
    const { version: _, ...channelWithoutVersion } = minimalChannel
    const channel: Channel = {
      ...channelWithoutVersion,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
      version: '', // Empty string
    }
    const payload = channelUnsignedPayloadForSigning(channel)
    expect(payload.version).toBe('1.0.0')
  })

  it('should omit empty summary', () => {
    const channel: Channel = {
      ...minimalChannel,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
      summary: '',
    }
    const payload = channelUnsignedPayloadForSigning(channel)
    expect(payload).not.toHaveProperty('summary')
  })

  it('should include non-empty summary', () => {
    const channel: Channel = {
      ...minimalChannel,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
      summary: 'Test summary',
    }
    const payload = channelUnsignedPayloadForSigning(channel)
    expect(payload.summary).toBe('Test summary')
  })

  it('should omit empty coverImage', () => {
    const channel: Channel = {
      ...minimalChannel,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
      coverImage: '',
    }
    const payload = channelUnsignedPayloadForSigning(channel)
    expect(payload).not.toHaveProperty('coverImage')
  })

  it('should include non-empty coverImage', () => {
    const channel: Channel = {
      ...minimalChannel,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
      coverImage: 'https://example.com/cover.jpg',
    }
    const payload = channelUnsignedPayloadForSigning(channel)
    expect(payload.coverImage).toBe('https://example.com/cover.jpg')
  })

  it('should omit empty curators array', () => {
    const channel: Channel = {
      ...minimalChannel,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
      curators: [],
    }
    const payload = channelUnsignedPayloadForSigning(channel)
    expect(payload).not.toHaveProperty('curators')
  })

  it('should include non-empty curators with entity wire format', () => {
    const channel: Channel = {
      ...channelWithMetadata,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
    }
    const payload = channelUnsignedPayloadForSigning(channel)
    expect(payload.curators).toBeDefined()
    expect(Array.isArray(payload.curators)).toBe(true)
  })

  it('should omit publisher if not provided', () => {
    const channel: Channel = {
      ...minimalChannel,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
      publisher: undefined,
    }
    const payload = channelUnsignedPayloadForSigning(channel)
    expect(payload).not.toHaveProperty('publisher')
  })

  it('should include publisher with entity wire format', () => {
    const channel: Channel = {
      ...minimalChannel,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
      publisher: {
        name: 'Publisher',
        key: 'did:pkh:eip155:1:0xpub',
        url: 'https://pub.com',
      },
    }
    const payload = channelUnsignedPayloadForSigning(channel)
    expect(payload.publisher).toBeDefined()
    const publisher = payload.publisher as { name: string; key: string; url?: string }
    expect(publisher.name).toBe('Publisher')
    expect(publisher.key).toBe('did:pkh:eip155:1:0xpub')
    expect(publisher.url).toBe('https://pub.com')
  })

  it('should generate slug correctly', () => {
    const channel: Channel = {
      ...minimalChannel,
      id: 'test-id',
      title: 'My Channel',
      slug: undefined,
      created: '2024-01-01T00:00:00Z',
    }
    const payload = channelUnsignedPayloadForSigning(channel)
    expect(payload.slug).toBeDefined()
    expect(typeof payload.slug).toBe('string')
  })

  it('should use provided slug if available', () => {
    const channel: Channel = {
      ...minimalChannel,
      id: 'test-id',
      slug: 'custom-slug',
      created: '2024-01-01T00:00:00Z',
    }
    const payload = channelUnsignedPayloadForSigning(channel)
    expect(payload.slug).toBe('custom-slug')
  })

  it('should produce JSON-serializable output', () => {
    const channel: Channel = {
      ...channelWithMetadata,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
    }
    const payload = channelUnsignedPayloadForSigning(channel)
    expect(() => JSON.stringify(payload)).not.toThrow()
  })

  it('should clone playlists array', () => {
    const playlists = ['https://example.com/playlist1']
    const channel: Channel = {
      ...minimalChannel,
      id: 'test-id',
      created: '2024-01-01T00:00:00Z',
      playlists,
    }
    const payload = channelUnsignedPayloadForSigning(channel)
    ;(payload.playlists as string[]).push('https://example.com/playlist2')
    expect(playlists.length).toBe(1)
  })
})
