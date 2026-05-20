/**
 * Tests for per-item display override helper.
 */

import { describe, it, expect } from 'vitest'
import { updateItemDisplay } from '@/lib/dp1ItemDisplay'
import type { PlaylistItem } from '@/types/dp1'

const baseItem: PlaylistItem = { source: 'https://example.com/video.m3u8' }

describe('updateItemDisplay', () => {
  it('sets a single field on a previously-undefined display', () => {
    const result = updateItemDisplay(baseItem, 'scaling', 'fill')
    expect(result.display).toEqual({ scaling: 'fill' })
  })

  it('preserves other override fields when adding one', () => {
    const item: PlaylistItem = {
      ...baseItem,
      display: { scaling: 'fit' },
    }
    const result = updateItemDisplay(item, 'background', '#222222')
    expect(result.display).toEqual({ scaling: 'fit', background: '#222222' })
  })

  it('overwrites an existing field value', () => {
    const item: PlaylistItem = {
      ...baseItem,
      display: { scaling: 'fit' },
    }
    const result = updateItemDisplay(item, 'scaling', 'fill')
    expect(result.display).toEqual({ scaling: 'fill' })
  })

  it('clears one override while preserving others', () => {
    const item: PlaylistItem = {
      ...baseItem,
      display: { scaling: 'fit', background: '#222222' },
    }
    const result = updateItemDisplay(item, 'background', undefined)
    expect(result.display).toEqual({ scaling: 'fit' })
  })

  it('removes the display key when the last override is cleared', () => {
    const item: PlaylistItem = {
      ...baseItem,
      display: { scaling: 'fit' },
    }
    const result = updateItemDisplay(item, 'scaling', undefined)
    expect(result.display).toBeUndefined()
    expect('display' in result).toBe(false)
  })

  it('is a no-op when clearing an unset field on a baseline item', () => {
    const result = updateItemDisplay(baseItem, 'scaling', undefined)
    expect(result.display).toBeUndefined()
    expect('display' in result).toBe(false)
  })

  it('supports boolean overrides (loop / autoplay)', () => {
    const result = updateItemDisplay(baseItem, 'loop', false)
    expect(result.display).toEqual({ loop: false })
    const cleared = updateItemDisplay(result, 'loop', undefined)
    expect('display' in cleared).toBe(false)
  })

  it('does not mutate the input item', () => {
    const item: PlaylistItem = {
      ...baseItem,
      display: { scaling: 'fit' },
    }
    const before = JSON.stringify(item)
    updateItemDisplay(item, 'scaling', 'fill')
    expect(JSON.stringify(item)).toBe(before)
  })
})
