import { describe, it, expect } from 'vitest'
import { parsePlaylistReference } from './playlistReference'

describe('parsePlaylistReference', () => {
  it('extracts the id-or-slug from a feed resource URL', () => {
    expect(parsePlaylistReference('https://feed.example/api/v1/playlists/my-slug-1a2b3c4d')).toBe(
      'my-slug-1a2b3c4d'
    )
    expect(parsePlaylistReference('  https://feed.example/api/v1/playlists/abc/  ')).toBe('abc')
    expect(parsePlaylistReference('https://feed.example/api/v1/playlists/a%20b')).toBe('a b')
  })

  it('accepts a bare UUID or slug', () => {
    expect(parsePlaylistReference('61e1dedd-0a73-45b7-8365-9c8e635b5017')).toBe(
      '61e1dedd-0a73-45b7-8365-9c8e635b5017'
    )
    expect(parsePlaylistReference('most-valuable-painting')).toBe('most-valuable-painting')
  })

  it('rejects input that cannot name a playlist', () => {
    expect(parsePlaylistReference('')).toBeNull()
    expect(parsePlaylistReference('   ')).toBeNull()
    expect(parsePlaylistReference('https://feed.example/api/v1/channels/abc')).toBeNull()
    expect(parsePlaylistReference('https://feed.example/api/v1/playlists/')).toBeNull()
    expect(parsePlaylistReference('two words')).toBeNull()
    expect(parsePlaylistReference('a/b')).toBeNull()
    expect(parsePlaylistReference('https://feed.example/api/v1/playlists/%E0%A4%A')).toBeNull()
  })
})
