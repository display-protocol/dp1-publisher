/**
 * Shape guard for the Content Rating Extension v0.1.0 item fields
 * (display-protocol/dp1 `extensions/content-rating`).
 *
 * Like `inlineManifestValidation`, this is deliberately NOT vocabulary
 * validation. The extension keeps `contentRating` open on the wire: a consumer
 * treats a value it does not recognise exactly as an absent one, so a newer
 * label must pass through here untouched. What the schema does pin is shape —
 * `contentRating` is a string, `contentReasons` is an array of non-empty
 * strings — and the spec ships rejected fixtures for exactly the mistakes a
 * JSON paste makes: `"contentRating": null`, `"contentReasons": [""]`,
 * `"contentReasons": "nudity"`.
 *
 * Why gate here at all: these fields ride through the form untouched (nothing
 * in the UI builds them), so a malformed value would otherwise go verbatim
 * into the bytes we sign. Today's feed stores documents as sent and does not
 * yet validate this extension, so it would accept the publish; a
 * rating-aware player then refuses the whole playlist as `playlistInvalid`,
 * and the only repair is a re-sign. Refusing before the wallet prompt is the
 * cheaper place to fail.
 */

/**
 * Returns an error message for a malformed `contentRating` / `contentReasons`
 * pair, or null when both are absent or well-shaped.
 */
export function validateItemContentRating(item: unknown, index: number): string | null {
  if (!item || typeof item !== 'object') return null
  const record = item as Record<string, unknown>

  // `undefined` reads as absent, as in the inlineManifest guard: serialization
  // drops it, so it never reaches the signed bytes.
  if (record.contentRating !== undefined && typeof record.contentRating !== 'string') {
    return `items[${index}].contentRating must be a string (omit the field for an unrated item).`
  }

  if (record.contentReasons !== undefined) {
    const reasons = record.contentReasons
    if (!Array.isArray(reasons)) {
      return `items[${index}].contentReasons must be an array of non-empty strings.`
    }
    if (reasons.some((r) => typeof r !== 'string' || r.length === 0)) {
      return `items[${index}].contentReasons must contain only non-empty strings.`
    }
  }
  return null
}
