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
})

describe('playlistItemExportCount', () => {
  it('reflects export filtering', () => {
    expect(playlistItemExportCount([emptyPlaceholder, seriesItem, seriesItem])).toBe(2)
  })
})
