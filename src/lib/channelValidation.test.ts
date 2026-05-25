import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
  const originalEnv = { ...import.meta.env }

  beforeEach(() => {
    delete (import.meta.env as Record<string, unknown>).VITE_DEBUG_MODE
  })

  afterEach(() => {
    ;(import.meta.env as Record<string, unknown>).VITE_DEBUG_MODE =
      originalEnv.VITE_DEBUG_MODE
  })
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

  // Defensive coverage: parseChannelJson only validates title and playlists
  // before casting to Channel, so publisher / curators can arrive as
  // arbitrary JSON-derived shapes through the JSON-tab path. The validator
  // must surface a destructive validation error instead of throwing.

  it('does not throw on non-string publisher.name and reports an error', () => {
    const errors = validateChannelFields({
      ...validChannel,
      publisher: { name: 123 as unknown as string, key: WALLET, url: '' },
    })
    expect(errors).toContainEqual({
      field: 'publisher.name',
      message: 'Publisher name is required',
    })
  })

  it('does not throw on non-object publisher and reports a shape error', () => {
    const errors = validateChannelFields({
      ...validChannel,
      publisher: 'not-an-object' as unknown as Channel['publisher'],
    })
    expect(errors).toContainEqual({
      field: 'publisher',
      message: 'Publisher must be an object',
    })
  })

  it('does not throw on non-array curators and reports a shape error', () => {
    const errors = validateChannelFields({
      ...validChannel,
      curators: {} as unknown as Channel['curators'],
    })
    expect(errors).toContainEqual({
      field: 'curators',
      message: 'Curators must be an array',
    })
  })

  it('does not throw on null curator entries and reports per-entry error', () => {
    const errors = validateChannelFields({
      ...validChannel,
      curators: [null, { name: 'NODE', key: WALLET, url: '' }] as unknown as Channel['curators'],
    })
    expect(errors).toContainEqual({
      field: 'curators[0]',
      message: 'Curator 1 must be an object',
    })
    // The valid second entry passes.
    expect(errors.find((e) => e.field.startsWith('curators[1]'))).toBeUndefined()
  })

  it('does not throw on primitive curator entries', () => {
    const errors = validateChannelFields({
      ...validChannel,
      curators: ['string-not-object'] as unknown as Channel['curators'],
    })
    expect(errors).toContainEqual({
      field: 'curators[0]',
      message: 'Curator 1 must be an object',
    })
  })

  it('does not throw on non-string title', () => {
    const errors = validateChannelFields({
      ...validChannel,
      title: 42 as unknown as string,
    })
    expect(errors).toContainEqual({ field: 'title', message: 'Title is required' })
  })

  // Round-7 finding: non-string optional scalars (slug / summary / coverImage)
  // were silently passing this gate, then crashing in the unsigned-payload
  // construction at `.trim()` / `generateChannelSlug`. These tests ensure
  // they now surface as validation errors before signing.

  it('rejects non-string slug (would crash later in generateChannelSlug)', () => {
    const errors = validateChannelFields({
      ...validChannel,
      slug: 123 as unknown as string,
    })
    expect(errors).toContainEqual({ field: 'slug', message: 'Slug must be a string' })
  })

  it('rejects non-string summary', () => {
    const errors = validateChannelFields({
      ...validChannel,
      summary: { lang: 'en', text: 'oops' } as unknown as string,
    })
    expect(errors).toContainEqual({
      field: 'summary',
      message: 'Summary must be a string',
    })
  })

  it('rejects non-string coverImage', () => {
    const errors = validateChannelFields({
      ...validChannel,
      coverImage: ['https://example.com/cover.jpg'] as unknown as string,
    })
    expect(errors).toContainEqual({
      field: 'coverImage',
      message: 'Cover image must be a string',
    })
  })

  it('still allows undefined / empty-string optional scalars', () => {
    expect(
      validateChannelFields({ ...validChannel, slug: undefined, summary: '', coverImage: undefined })
    ).toEqual([])
  })

  // Round-12 preemptive guard: feed reconstructs playlists as []string; a
  // non-string entry would survive in client signed bytes but be dropped
  // feed-side → signature mismatch on the JSON-import path.
  it('rejects a non-string entry in playlists[]', () => {
    const errors = validateChannelFields({
      ...validChannel,
      playlists: ['https://feed.example.com/p.json', 42 as unknown as string],
    })
    expect(errors).toContainEqual({
      field: 'playlists[1]',
      message: 'playlists[1] must be a string URI',
    })
  })

  it('rejects empty-string entry in playlists[]', () => {
    const errors = validateChannelFields({
      ...validChannel,
      playlists: ['https://feed.example.com/p.json', ''],
    })
    expect(errors).toContainEqual({
      field: 'playlists[1]',
      message: 'playlists[1] must be a non-empty string',
    })
  })

  it('rejects null entry in playlists[]', () => {
    const errors = validateChannelFields({
      ...validChannel,
      playlists: ['https://feed.example.com/p.json', null as unknown as string],
    })
    expect(errors).toContainEqual({
      field: 'playlists[1]',
      message: 'playlists[1] must be a string URI',
    })
  })

  it('rejects http playlist URI in production mode', () => {
    const errors = validateChannelFields({
      ...validChannel,
      playlists: ['http://example.com/playlist.json'],
    })
    expect(errors.some((e) => e.field === 'playlists[0]')).toBe(true)
  })
})
