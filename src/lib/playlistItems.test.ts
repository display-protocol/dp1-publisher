import { describe, it, expect } from 'vitest'
import {
  isEmptyManualPlaceholder,
  itemsForPlaylistExport,
  playlistItemExportCount,
} from '@/lib/playlistItems'
import type { PlaylistItem } from '@/types/dp1'

const emptyPlaceholder: PlaylistItem = {
  source: '',
  title: '',
  duration: undefined,
  license: undefined,
}

const seriesItem: PlaylistItem = {
  id: 'abc',
  source: 'https://example.com/a.mp4',
  provenance: {
    type: 'onChain',
    contract: { chain: 'evm', address: '0x1', tokenId: '1' },
  },
}

describe('isEmptyManualPlaceholder', () => {
  it('returns true for the default blank manual row', () => {
    expect(isEmptyManualPlaceholder(emptyPlaceholder)).toBe(true)
  })

  it('returns false when source or provenance is set', () => {
    expect(isEmptyManualPlaceholder({ ...emptyPlaceholder, source: 'https://x' })).toBe(false)
    expect(isEmptyManualPlaceholder(seriesItem)).toBe(false)
  })

  // Every user-editable PlaylistItem field must be checked so that a partial manual
  // row is never silently dropped alongside a series-loaded item.
  it('returns false when duration is set', () => {
    expect(isEmptyManualPlaceholder({ ...emptyPlaceholder, duration: 30 })).toBe(false)
  })

  it('returns false when license is set', () => {
    expect(isEmptyManualPlaceholder({ ...emptyPlaceholder, license: 'token' })).toBe(false)
  })

  it('returns false when override is set', () => {
    expect(isEmptyManualPlaceholder({ ...emptyPlaceholder, override: { foo: 'bar' } })).toBe(false)
  })

  it('returns false when repro is set', () => {
    expect(
      isEmptyManualPlaceholder({
        ...emptyPlaceholder,
        repro: { seed: 'abc123' },
      })
    ).toBe(false)
  })

  // Regression: edit-mode items loaded from the feed carry an id. Even if the
  // curator clears the source field, the item must not be dropped as a placeholder —
  // the missing-source validation gate should fire instead.
  it('returns false when id is set (edit-mode persisted item)', () => {
    expect(isEmptyManualPlaceholder({ ...emptyPlaceholder, id: 'some-uuid' })).toBe(false)
  })

  it('returns false when displayAt is set', () => {
    expect(
      isEmptyManualPlaceholder({ ...emptyPlaceholder, displayAt: '2026-01-01T10:00:00' })
    ).toBe(false)
  })

  it('treats a whitespace-only displayAt as no content', () => {
    expect(isEmptyManualPlaceholder({ ...emptyPlaceholder, displayAt: '   ' })).toBe(true)
  })

  it('returns false when inlineManifest is set', () => {
    expect(
      isEmptyManualPlaceholder({
        ...emptyPlaceholder,
        inlineManifest: {
          refVersion: '0.1.0',
          id: 'ref-9d26ecb3',
          created: '2026-07-28T00:00:00Z',
          locale: 'en',
        },
      })
    ).toBe(false)
  })
})

describe('itemsForPlaylistExport', () => {
  it('keeps a lone empty placeholder when nothing else was added', () => {
    expect(itemsForPlaylistExport([emptyPlaceholder])).toEqual([emptyPlaceholder])
  })

  it('drops the first empty placeholder when series items exist', () => {
    expect(itemsForPlaylistExport([emptyPlaceholder, seriesItem])).toEqual([seriesItem])
  })

  it('keeps a filled first manual item alongside series items', () => {
    const manual = { ...emptyPlaceholder, source: 'https://manual.example' }
    expect(itemsForPlaylistExport([manual, seriesItem])).toEqual([manual, seriesItem])
  })

  // Regression: a manual row whose only curator-entered value is a per-item
  // displayAt schedule must survive export alongside series items — dropping it
  // would silently discard the schedule from the signed playlist.
  it('keeps a first manual item whose only content is displayAt', () => {
    const scheduled = { ...emptyPlaceholder, displayAt: '2026-01-01T10:00:00' }
    expect(itemsForPlaylistExport([scheduled, seriesItem])).toEqual([scheduled, seriesItem])
  })

  // Same reasoning as displayAt: an item whose only curator-supplied content is
  // the inline Ref Manifest carries the metadata a player labels the work with.
  it('keeps a first manual item whose only content is inlineManifest', () => {
    const described = {
      ...emptyPlaceholder,
      inlineManifest: {
        refVersion: '0.1.0',
        id: 'ref-9d26ecb3',
        created: '2026-07-28T00:00:00Z',
        locale: 'en',
      },
    }
    expect(itemsForPlaylistExport([described, seriesItem])).toEqual([described, seriesItem])
  })

  it('does not drop a persisted edit-mode item that has an id but blank source', () => {
    // In edit mode the first item may have an id (assigned by the feed) but a
    // curator-cleared source. It must survive export so validation surfaces the
    // missing-source error rather than silently omitting the item.
    const editModeItem = { ...emptyPlaceholder, id: 'feed-uuid' }
    expect(itemsForPlaylistExport([editModeItem, seriesItem])).toEqual([editModeItem, seriesItem])
  })
})

describe('playlistItemExportCount', () => {
  it('reflects export filtering', () => {
    expect(playlistItemExportCount([emptyPlaceholder, seriesItem, seriesItem])).toBe(2)
  })
})

// Regression: series-loaded items must survive itemsForPlaylistExport regardless of
// whether Dynamic Query is concurrently active in the form. The Dynamic Query block
// is a separate top-level field on the signed playlist; coexistence is intentional and
// curators are notified by PlaylistForm when both are active (see handleSeriesAdd).
describe('series items are preserved for export alongside dynamic query state', () => {
  it('does not drop series items — dynamic query is a separate concern', () => {
    const result = itemsForPlaylistExport([seriesItem])
    expect(result).toEqual([seriesItem])
  })

  it('drops only the empty placeholder, keeps all series items', () => {
    const second = { ...seriesItem, id: 'def', source: 'https://example.com/b.mp4' }
    const result = itemsForPlaylistExport([emptyPlaceholder, seriesItem, second])
    expect(result).toEqual([seriesItem, second])
  })
})
