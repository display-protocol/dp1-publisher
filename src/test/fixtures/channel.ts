/**
 * Test fixtures for DP-1 Channel documents
 * Reusing patterns from dp1-js tests
 */

import type { Channel, Entity } from '@/types/dp1'

export const minimalChannel: Channel = {
  version: '1.1.0',
  title: 'Test Channel',
  playlists: ['https://example.com/playlist1'],
  signatures: [],
}

export const channelWithMetadata: Channel = {
  version: '1.1.0',
  id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  title: 'Digital Art Channel',
  slug: 'digital-art',
  summary: 'A channel for digital art collections',
  coverImage: 'https://example.com/channel-cover.jpg',
  playlists: [
    'https://example.com/playlist1',
    'https://example.com/playlist2',
  ],
  curators: [
    {
      name: 'Curator One',
      key: 'did:pkh:eip155:1:0x1111111111111111111111111111111111111111',
    },
  ],
  publisher: {
    name: 'Publisher Inc',
    key: 'did:pkh:eip155:1:0x2222222222222222222222222222222222222222',
    url: 'https://publisher.example.com',
  },
  signatures: [],
}

export const channelWithEmptyFields: Channel = {
  version: '1.1.0',
  title: 'Channel',
  playlists: ['https://example.com/playlist1'],
  summary: '',
  coverImage: '',
  signatures: [],
}

export const publisherEntity: Entity = {
  name: 'Test Publisher',
  key: 'did:pkh:eip155:1:0x9876543210987654321098765432109876543210',
  url: 'https://publisher.test',
}
