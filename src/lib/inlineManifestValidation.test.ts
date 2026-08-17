/**
 * Tests for the playlists-extension §3.6 inlineManifest envelope guard.
 * Scope check only — the normative ref-manifest schema lives in dp1-go.
 */

import { describe, it, expect } from 'vitest'
import { validateItemInlineManifest } from '@/lib/inlineManifestValidation'

const validManifest = {
  refVersion: '0.1.0',
  id: 'ref-9d26ecb3',
  created: '2026-07-28T00:00:00Z',
  locale: 'en',
}

describe('validateItemInlineManifest', () => {
  it('accepts an item without an inlineManifest', () => {
    expect(validateItemInlineManifest({ source: 'https://example.com/a.html' }, 0)).toBeNull()
  })

  it('accepts the §3.6 example manifest', () => {
    const item = {
      source: 'https://example.com/art/pre-process.html',
      inlineManifest: {
        ...validManifest,
        metadata: { title: 'Pre-Process', artists: [{ name: 'Casey Reas', id: '' }] },
      },
    }
    expect(validateItemInlineManifest(item, 0)).toBeNull()
  })

  it('accepts fields it does not model', () => {
    const item = {
      source: 'https://example.com/a.html',
      inlineManifest: { ...validManifest, somethingNobodyModelsYet: { deep: [1, 2, 3] } },
    }
    expect(validateItemInlineManifest(item, 0)).toBeNull()
  })

  it.each([
    ['null', null],
    ['a string', 'https://example.com/manifest.json'],
    ['an array', [validManifest]],
    ['a number', 7],
  ])('rejects %s in place of a manifest object', (_label, value) => {
    const error = validateItemInlineManifest(
      { source: 'https://example.com/a.html', inlineManifest: value },
      2
    )
    expect(error).toBe('items[2].inlineManifest must be a Ref Manifest object.')
  })

  it('names every missing envelope field at once', () => {
    const error = validateItemInlineManifest(
      { source: 'https://example.com/a.html', inlineManifest: { refVersion: '0.1.0', id: 'r' } },
      1
    )
    expect(error).toBe(
      'items[1].inlineManifest is missing required Ref Manifest fields: created, locale.'
    )
  })

  it('treats a blank or non-string envelope value as missing', () => {
    const error = validateItemInlineManifest(
      {
        source: 'https://example.com/a.html',
        inlineManifest: { ...validManifest, locale: '   ', created: 42 },
      },
      0
    )
    expect(error).toBe(
      'items[0].inlineManifest is missing required Ref Manifest fields: created, locale.'
    )
  })

  it('ignores a non-object item (the caller reports that separately)', () => {
    expect(validateItemInlineManifest(null, 0)).toBeNull()
    expect(validateItemInlineManifest('not an item', 0)).toBeNull()
  })
})
