/**
 * Tests for the Content Rating Extension shape guard. Shape only — the
 * vocabulary is open on the wire and the normative schema lives in dp1.
 */

import { describe, it, expect } from 'vitest'
import { validateItemContentRating } from '@/lib/contentRatingValidation'

describe('validateItemContentRating', () => {
  it('accepts an unrated item', () => {
    expect(validateItemContentRating({ source: 'https://example.com/a.html' }, 0)).toBeNull()
  })

  it('accepts the defined labels, with and without reasons', () => {
    expect(validateItemContentRating({ contentRating: 'general' }, 0)).toBeNull()
    expect(
      validateItemContentRating(
        { contentRating: 'mature', contentReasons: ['nudity', 'medical imagery'] },
        0
      )
    ).toBeNull()
  })

  it('accepts a label it does not recognise (open vocabulary, dp1 §3.3)', () => {
    expect(validateItemContentRating({ contentRating: 'teen' }, 0)).toBeNull()
  })

  it('accepts an empty reasons array and reasons without a rating', () => {
    expect(validateItemContentRating({ contentRating: 'mature', contentReasons: [] }, 0)).toBeNull()
    expect(validateItemContentRating({ contentReasons: ['nudity'] }, 0)).toBeNull()
  })

  // The three rejected fixtures shipped with the extension
  // (examples/items/rejected/*.json).
  it('rejects a null rating (content-rating-null.json)', () => {
    expect(validateItemContentRating({ contentRating: null }, 2)).toMatch(
      /^items\[2\]\.contentRating must be a string/
    )
  })

  it('rejects a non-string rating', () => {
    expect(validateItemContentRating({ contentRating: 1 }, 0)).toMatch(/contentRating must be a string/)
  })

  it('rejects an empty-string reason (content-reasons-empty-string.json)', () => {
    expect(validateItemContentRating({ contentRating: 'mature', contentReasons: [''] }, 1)).toMatch(
      /^items\[1\]\.contentReasons must contain only non-empty strings/
    )
  })

  it('rejects reasons that are not an array (content-reasons-not-array.json)', () => {
    expect(validateItemContentRating({ contentRating: 'mature', contentReasons: 'nudity' }, 0)).toMatch(
      /contentReasons must be an array/
    )
  })

  it('ignores a non-object item (the caller reports that separately)', () => {
    expect(validateItemContentRating(null, 0)).toBeNull()
    expect(validateItemContentRating('x', 0)).toBeNull()
  })
})
