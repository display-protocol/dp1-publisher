/**
 * Cheap envelope guard for the playlists-extension §3.6 `inlineManifest`.
 *
 * This is deliberately NOT schema validation. The normative check is the
 * unmodified ref-manifest schema, which dp1-go v0.6.0 applies on the
 * extension parse path; this repo has no schema validator at all. What it
 * catches is the class of mistake that would otherwise be invisible until the
 * feed rejects the publish: `inlineManifest` is an arbitrary object that goes
 * verbatim into the bytes we sign, so unlike a scalar field there is nothing
 * about a malformed one that the rest of the pipeline would notice.
 *
 * §3.6: "Emitters MUST populate the manifest envelope (refVersion, id,
 * created, locale) exactly as they would for a hosted manifest." Those four
 * are `required` in the ref-manifest schema, so demanding them here can only
 * reject documents the feed would reject too.
 */

const ENVELOPE_FIELDS = ['refVersion', 'id', 'created', 'locale'] as const

/**
 * Returns an error message for a malformed `inlineManifest`, or null when the
 * field is absent or plausibly shaped.
 *
 * Call it on items that are about to be signed — `preparePublish` runs it
 * after the extension strip, so with extensions off there is nothing left to
 * reject and the gate needs no separate flag. Validating the strip's output
 * rather than its input is also what keeps this honest: what we check is
 * exactly what we sign.
 */
export function validateItemInlineManifest(item: unknown, index: number): string | null {
  if (!item || typeof item !== 'object') return null
  const value = (item as Record<string, unknown>).inlineManifest
  if (value === undefined) return null

  const path = `items[${index}].inlineManifest`
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return `${path} must be a Ref Manifest object.`
  }

  const manifest = value as Record<string, unknown>
  const missing = ENVELOPE_FIELDS.filter((field) => {
    const v = manifest[field]
    return typeof v !== 'string' || v.trim() === ''
  })
  if (missing.length > 0) {
    return `${path} is missing required Ref Manifest fields: ${missing.join(', ')}.`
  }
  return null
}
