import { describe, it, expect } from 'vitest'
import { validateChannelFields } from '@/lib/channelValidation'
import type { Channel } from '@/types/dp1'

const WALLET = 'did:pkh:eip155:1:0xabcdef0123456789abcdef0123456789abcdef01'

const validChannel: Channel = {
  title: 'OCCUPY',
  slug: 'occupy',
  version: '1.0.0',
  playlists: ['https://feed.example.com/p.json'],
  publisher: { name: 'NODE', key: WALLET, url: 'https://node.art' },
}

describe('validateChannelFields', () => {
  it('returns no errors for a fully-valid channel', () => {
    expect(validateChannelFields(validChannel)).toEqual([])
  })

  // Regression guard for PR #2: the JSON-tab create path used to skip
  // validation entirely. After auto-injecting a publisher with `name: ''`
  // (when pasted JSON had no publisher), the channel would sign and POST
  // — only to be rejected by the feed. With validation now wired into the
  // JSON-tab path, this scenario errors *before* the wallet ever signs.
  it('rejects publisher with empty name (the post-auto-inject scenario)', () => {
    const errors = validateChannelFields({
      ...validChannel,
      publisher: { name: '', key: WALLET, url: '' },
    })
    expect(errors).toContainEqual({
      field: 'publisher.name',
      message: 'Publisher name is required',
    })
  })

  it('rejects publisher with whitespace-only name', () => {
    const errors = validateChannelFields({
      ...validChannel,
      publisher: { name: '   ', key: WALLET, url: '' },
    })
    expect(errors).toContainEqual({
      field: 'publisher.name',
      message: 'Publisher name is required',
    })
  })

  it('rejects publisher with non-DID key', () => {
    const errors = validateChannelFields({
      ...validChannel,
      publisher: { name: 'NODE', key: 'not-a-did', url: '' },
    })
    expect(errors).toContainEqual({
      field: 'publisher.key',
      message: 'Publisher key must be in DID format',
    })
  })

  it('rejects publisher with invalid URL scheme', () => {
    const errors = validateChannelFields({
      ...validChannel,
      publisher: { name: 'NODE', key: WALLET, url: 'ftp://node.art' },
    })
    expect(errors).toContainEqual({
      field: 'publisher.url',
      message: 'Publisher URL must be a valid HTTP(S) URL',
    })
  })

  it('rejects channel with empty title', () => {
    const errors = validateChannelFields({ ...validChannel, title: '' })
    expect(errors).toContainEqual({ field: 'title', message: 'Title is required' })
  })

  it('rejects channel with empty playlists array', () => {
    const errors = validateChannelFields({ ...validChannel, playlists: [] })
    expect(errors).toContainEqual({
      field: 'playlists',
      message: 'At least one playlist URI is required',
    })
  })

  it('rejects slug with uppercase or invalid characters', () => {
    expect(
      validateChannelFields({ ...validChannel, slug: 'OCCUPY' })
    ).toContainEqual({
      field: 'slug',
      message: 'Slug must contain only lowercase letters, numbers, and hyphens',
    })
    expect(
      validateChannelFields({ ...validChannel, slug: 'spaces here' })
    ).toContainEqual({
      field: 'slug',
      message: 'Slug must contain only lowercase letters, numbers, and hyphens',
    })
  })

  it('accumulates multiple errors', () => {
    const errors = validateChannelFields({
      title: '',
      version: '1.0.0',
      playlists: [],
      publisher: { name: '', key: 'bad', url: '' },
    })
    expect(errors.length).toBeGreaterThanOrEqual(4)
  })
})
