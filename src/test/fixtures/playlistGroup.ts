/**
 * Test fixtures for DP-1 Playlist Group documents
 */

import type { PlaylistGroup } from '@/types/dp1'

export const minimalPlaylistGroup: PlaylistGroup = {
  title: 'Test Group',
  playlists: ['https://example.com/playlist1'],
  signatures: [],
}

export const playlistGroupWithMetadata: PlaylistGroup = {
  id: 'a1b2c3d4-e5f6-4a5b-8c7d-9e0f1a2b3c4d',
  title: 'Featured Groups',
  slug: 'featured-groups',
  summary: 'A collection of featured playlists',
  coverImage: 'https://example.com/group-cover.jpg',
  playlists: [
    'https://example.com/playlist1',
    'https://example.com/playlist2',
    'https://example.com/playlist3',
  ],
  curator: 'did:pkh:eip155:1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  signatures: [],
}

export const playlistGroupWithEmptyFields: PlaylistGroup = {
  title: 'Group',
  playlists: ['https://example.com/playlist1'],
  summary: '',
  coverImage: '',
  curator: '',
  signatures: [],
}
