import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { validatePlaylistUriList } from '@/lib/playlistUriListValidation'

describe('validatePlaylistUriList', () => {
  const originalEnv = { ...import.meta.env }

  beforeEach(() => {
    delete (import.meta.env as Record<string, unknown>).VITE_DEBUG_MODE
  })

  afterEach(() => {
    ;(import.meta.env as Record<string, unknown>).VITE_DEBUG_MODE =
      originalEnv.VITE_DEBUG_MODE
  })

  it('requires at least one playlist URI', () => {
    expect(validatePlaylistUriList([])).toContainEqual({
      field: 'playlists',
      message: 'At least one playlist URI is required',
    })
  })

  it('accepts valid https URIs', () => {
    expect(validatePlaylistUriList(['https://example.com/p.json'])).toEqual([])
  })

  it('rejects http playlist URI in production mode', () => {
    const errors = validatePlaylistUriList(['http://example.com/playlist.json'])
    expect(errors.some((e) => e.field === 'playlists[0]')).toBe(true)
  })

  it('rejects non-string entry', () => {
    const errors = validatePlaylistUriList([
      'https://example.com/p1',
      42 as unknown as string,
    ])
    expect(errors).toContainEqual({
      field: 'playlists[1]',
      message: 'playlists[1] must be a string URI',
    })
  })

  it('rejects empty-string entry', () => {
    const errors = validatePlaylistUriList(['https://example.com/p1', ''])
    expect(errors).toContainEqual({
      field: 'playlists[1]',
      message: 'playlists[1] must be a non-empty string',
    })
  })
})
