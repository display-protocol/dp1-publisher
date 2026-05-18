/**
 * Test fixtures for DP-1 Playlist documents
 * Reusing patterns from dp1-js tests
 */

import type { Playlist, PlaylistItem, Entity } from '@/types/dp1'

export const minimalPlaylist: Playlist = {
  dpVersion: '1.1.0',
  title: 'Test Playlist',
  items: [
    {
      source: 'https://example.com/art1.png',
    },
  ],
  signatures: [],
}

export const playlistWithMetadata: Playlist = {
  dpVersion: '1.1.0',
  id: '385f79b6-a45f-4c1c-8080-e93a192adccc',
  title: 'Featured Collection',
  slug: 'featured-collection',
  summary: 'A curated collection of digital art',
  coverImage: 'https://example.com/cover.jpg',
  items: [
    {
      source: 'https://example.com/art1.png',
      license: 'token',
      display: { scaling: 'fit' },
    },
    {
      source: 'https://example.com/art2.png',
      note: { text: 'Featured piece', duration: 10 },
    },
  ],
  defaults: {
    display: { scaling: 'fill', autoplay: true },
    license: 'open',
  },
  curators: [
    {
      name: 'Alice',
      key: 'did:pkh:eip155:1:0x1234567890123456789012345678901234567890',
    },
  ],
  signatures: [],
}

export const playlistWithNote: Playlist = {
  dpVersion: '1.1.0',
  title: 'Playlist With Note',
  note: { text: 'Welcome message', duration: 5 },
  items: [
    {
      source: 'https://example.com/art.png',
    },
  ],
  signatures: [],
}

export const playlistItem: PlaylistItem = {
  source: 'https://example.com/artwork.png',
  license: 'token',
  display: { scaling: 'fit', autoplay: true },
  note: { text: 'Item description' },
}

export const curatorEntity: Entity = {
  name: 'Test Curator',
  key: 'did:pkh:eip155:1:0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
  url: 'https://curator.example.com',
}

export const publisherEntity: Entity = {
  name: 'Test Publisher',
  key: 'did:pkh:eip155:1:0x9876543210987654321098765432109876543210',
}

// Playlist with legacy signature field (should be stripped)
export const playlistWithLegacySignature = {
  dpVersion: '1.1.0',
  title: 'Legacy Signed',
  signature: 'ed25519:oldformat',
  items: [{ source: 'https://example.com/art.png' }],
  signatures: [],
}

// Playlist with existing signatures (should be stripped before signing)
export const playlistWithSignatures: Playlist = {
  dpVersion: '1.1.0',
  title: 'Already Signed',
  items: [{ source: 'https://example.com/art.png' }],
  signatures: [
    {
      alg: 'eip191',
      kid: 'did:pkh:eip155:1:0x1234567890123456789012345678901234567890',
      ts: '2024-01-01T00:00:00Z',
      payload_hash: 'sha256:' + '0'.repeat(64),
      role: 'curator',
      sig: 'test-signature',
    },
  ],
}
