import { describe, it, expect } from 'vitest'
import { validatePlaylistGroupFields } from '@/lib/playlistGroupValidation'
import type { PlaylistGroup } from '@/types/dp1'

const WALLET = 'did:pkh:eip155:1:0xabcdef0123456789abcdef0123456789abcdef01'

const validGroup: PlaylistGroup = {
  id: 'grp-1',
  created: '2026-05-22T00:00:00Z',
  title: 'Test Group',
  playlists: ['https://example.com/p1'],
  curator: WALLET,
}

describe('validatePlaylistGroupFields', () => {
  it('accepts a valid group', () => {
    expect(validatePlaylistGroupFields(validGroup)).toEqual([])
  })

  it('requires title', () => {
    const errors = validatePlaylistGroupFields({ ...validGroup, title: '' })
    expect(errors.some((e) => e.field === 'title')).toBe(true)
  })

  it('requires at least one playlist URI', () => {
    const errors = validatePlaylistGroupFields({ ...validGroup, playlists: [] })
    expect(errors.some((e) => e.field === 'playlists')).toBe(true)
  })

  it('requires curator DID', () => {
    const errors = validatePlaylistGroupFields({ ...validGroup, curator: '' })
    expect(errors.some((e) => e.field === 'curator')).toBe(true)
  })

  it('rejects invalid curator DID format', () => {
    const errors = validatePlaylistGroupFields({ ...validGroup, curator: 'not-a-did' })
    expect(errors.some((e) => e.field === 'curator')).toBe(true)
  })

  it('rejects invalid slug format', () => {
    const errors = validatePlaylistGroupFields({ ...validGroup, slug: 'Bad_Slug' })
    expect(errors.some((e) => e.field === 'slug')).toBe(true)
  })
})
