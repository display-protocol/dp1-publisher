/**
 * Spec fields the signing whitelist used to drop silently (DP-1 conformance
 * audit, R5/R9/R10). Each was lost *before* hashing, so a replace re-signed the
 * stored document without it — `visibility: "unlisted"` most harmfully, since
 * an absent `visibility` means public.
 */

import { describe, it, expect } from 'vitest'
import { playlistUnsignedPayloadForSigning } from '@/lib/playlistSignPayload'
import { channelUnsignedPayloadForSigning } from '@/lib/channelSignPayload'
import { entityWire } from '@/lib/dp1EntityWire'
import {
  playlistExtensionFieldsPresent,
  stripPlaylistExtensionFields,
} from '@/lib/dp1ExtensionPolicy'
import { mergePlaylistForPatch } from '@/lib/dp1Merge'
import { minimalPlaylist } from '@/test/fixtures/playlist'
import type { Playlist } from '@/types/dp1'

const base: Playlist = { ...minimalPlaylist, id: 'a1b2c3d4-0000-4000-8000-000000000001' }

describe('playlist-level extension fields survive the whitelist', () => {
  it('keeps visibility "unlisted" (and "" which also means unlisted)', () => {
    expect(playlistUnsignedPayloadForSigning({ ...base, visibility: 'unlisted' }).visibility).toBe(
      'unlisted'
    )
    expect(playlistUnsignedPayloadForSigning({ ...base, visibility: '' }).visibility).toBe('')
  })

  it('drops only a JSON null visibility (Go *string omitempty)', () => {
    const p = { ...base, visibility: null } as unknown as Playlist
    expect(playlistUnsignedPayloadForSigning(p)).not.toHaveProperty('visibility')
  })

  it('keeps openAt, links and satellites and filters unknown keys inside them', () => {
    const p = {
      ...base,
      openAt: '2026-11-01T18:00:00Z',
      links: [
        {
          type: 'article',
          url: 'https://example.com/a',
          title: 'T',
          authors: [{ name: 'Writer', role: 'author', extra: 1 }],
          junk: true,
        },
      ],
      satellites: [{ playlist: 'https://feed.example/p/1', kind: 'burn', junk: 1 }],
    } as unknown as Playlist
    const out = playlistUnsignedPayloadForSigning(p)
    expect(out.openAt).toBe('2026-11-01T18:00:00Z')
    expect(out.links).toEqual([
      {
        type: 'article',
        url: 'https://example.com/a',
        title: 'T',
        authors: [{ name: 'Writer', role: 'author' }],
      },
    ])
    expect(out.satellites).toEqual([{ playlist: 'https://feed.example/p/1', kind: 'burn' }])
  })

  it('drops empty links/satellites arrays', () => {
    const out = playlistUnsignedPayloadForSigning({ ...base, links: [], satellites: [] })
    expect(out).not.toHaveProperty('links')
    expect(out).not.toHaveProperty('satellites')
  })
})

describe('nested spec fields survive', () => {
  it('keeps display.imageRendering, note.title/author and items[].refHash', () => {
    const p = {
      ...base,
      items: [
        {
          source: 'https://example.com/a.html',
          ref: 'https://example.com/m.json',
          refHash: 'sha256:abc',
          display: { imageRendering: 'pixelated' },
          note: { text: 'hi', title: 'T', author: { name: 'A', role: 'curator' } },
        },
      ],
    } as unknown as Playlist
    const item = (playlistUnsignedPayloadForSigning(p).items as Record<string, unknown>[])[0]
    expect(item.refHash).toBe('sha256:abc')
    expect(item.display).toEqual({ imageRendering: 'pixelated' })
    expect(item.note).toEqual({
      text: 'hi',
      title: 'T',
      author: { name: 'A', role: 'curator' },
    })
  })

  it('keeps defaults.display.imageRendering', () => {
    const out = playlistUnsignedPayloadForSigning({
      ...base,
      defaults: { display: { imageRendering: 'auto' } },
    })
    expect(out.defaults).toEqual({ display: { imageRendering: 'auto' } })
  })

  it('keeps a string provenance seriesId', () => {
    const p = {
      ...base,
      items: [
        {
          source: 'https://example.com/a',
          provenance: { type: 'seriesRegistry', contract: { seriesId: '123456789012345678901' } },
        },
      ],
    } as unknown as Playlist
    const item = (playlistUnsignedPayloadForSigning(p).items as Record<string, unknown>[])[0]
    expect((item.provenance as { contract: { seriesId: string } }).contract.seriesId).toBe(
      '123456789012345678901'
    )
  })
})

describe('entityWire carries the full Entity', () => {
  it('keeps profile fields and drops unknown ones and empties', () => {
    const e = {
      name: 'Ana',
      key: 'did:key:z',
      id: 'ana-1',
      role: 'curator',
      location: 'Berlin',
      addresses: ['0xabc'],
      avatar: { uri: 'https://x/a.png', w: 10 },
      biographies: [{ text: 'bio', sourceUrl: 'https://x/b' }],
      links: [{ type: 'website', url: 'https://ana.example' }],
      url: '',
      extra: 1,
    }
    expect(entityWire(e)).toEqual({
      name: 'Ana',
      key: 'did:key:z',
      id: 'ana-1',
      role: 'curator',
      location: 'Berlin',
      addresses: ['0xabc'],
      avatar: { uri: 'https://x/a.png', w: 10 },
      biographies: [{ text: 'bio', sourceUrl: 'https://x/b' }],
      links: [{ type: 'website', url: 'https://ana.example' }],
    })
  })

  it('reaches channel curators and publisher', () => {
    const out = channelUnsignedPayloadForSigning({
      id: 'c1',
      created: '2026-01-01T00:00:00Z',
      title: 'Ch',
      version: '1.0.0',
      playlists: ['https://f/p/1'],
      publisher: { name: 'Pub', key: 'did:key:p', location: 'Paris' },
    })
    expect((out.publisher as Record<string, unknown>).location).toBe('Paris')
  })
})

describe('omitempty and defaults for the new members', () => {
  it('drops empty refHash and empty satellite title/note, keeps required satellite keys', () => {
    const out = playlistUnsignedPayloadForSigning({
      ...base,
      items: [{ source: 'https://e.com/a', refHash: '' }],
      satellites: [{ playlist: 'https://f/p/1', kind: 'burn', title: '', note: '' }],
    })
    expect((out.items as Record<string, unknown>[])[0]).not.toHaveProperty('refHash')
    expect(out.satellites).toEqual([{ playlist: 'https://f/p/1', kind: 'burn' }])
  })

  it('always emits an Entity name, even for a nameless note author', () => {
    expect(entityWire({ role: 'curator' } as unknown as Parameters<typeof entityWire>[0])).toEqual({
      name: '',
      role: 'curator',
    })
  })
})

describe('mergePlaylistForPatch with the new fields', () => {
  it('keeps the stored value when the edit omits it, and takes the edit when it states one', () => {
    const existing: Playlist = { ...base, visibility: 'unlisted' }
    expect(mergePlaylistForPatch(existing, {}).visibility).toBe('unlisted')
    expect(mergePlaylistForPatch(existing, { visibility: 'public' }).visibility).toBe('public')
  })
})

describe('extension policy knows the new fields', () => {
  it('reports them as extension fields a replace would erase', () => {
    const p: Playlist = {
      ...base,
      visibility: 'unlisted',
      openAt: '2026-01-01T00:00:00Z',
      links: [{ type: 'news', url: 'https://x' }],
      satellites: [{ playlist: 'https://f/p/2', kind: 'burn' }],
    }
    expect(playlistExtensionFieldsPresent(p)).toEqual(
      expect.arrayContaining(['visibility', 'openAt', 'links', 'satellites'])
    )
  })

  it('does not flag values that read the same as absent', () => {
    expect(playlistExtensionFieldsPresent({ ...base, visibility: 'public', openAt: '' })).toEqual([])
  })

  it('strips them when extensions are off', () => {
    const stripped = stripPlaylistExtensionFields({ ...base, visibility: 'unlisted', openAt: 'x' })
    expect(stripped).not.toHaveProperty('visibility')
    expect(stripped).not.toHaveProperty('openAt')
  })
})
