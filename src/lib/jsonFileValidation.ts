/**
 * File-input validation for the JSON drop / picker affordance.
 *
 * The drop path bypasses the file picker's `accept` attribute entirely, and
 * `accept` is advisory even for the picker itself — so the editor must do its
 * own gating before reading file contents into the publish path.
 */

/** Hard cap. Realistic DP-1 documents are kilobytes; 5 MB is generous headroom. */
export const MAX_JSON_FILE_BYTES = 5 * 1024 * 1024

export interface JsonFileValidation {
  ok: boolean
  /** Operator-facing rejection reason (only present when `ok` is false). */
  reason?: string
}

/**
 * Accept the file when:
 * - size is within the cap, AND
 * - filename ends in `.json` (case-insensitive), OR
 * - MIME explicitly contains "json" (e.g., application/json).
 *
 * Ambiguous MIME (empty, `text/plain`, anything else) is **only** accepted
 * when the filename ends in `.json`. This blocks `notes.txt`-style files
 * with a `text/*` MIME and extension-less files with empty MIME from
 * landing in the JSON editor before downstream parse validation runs.
 * Drop sources that report empty `file.type` still work as long as the
 * filename has a `.json` extension.
 */
export function validateJsonFile(file: File): JsonFileValidation {
  if (file.size > MAX_JSON_FILE_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1)
    const cap = (MAX_JSON_FILE_BYTES / 1024 / 1024).toFixed(0)
    return { ok: false, reason: `File is ${mb} MB — over the ${cap} MB limit.` }
  }
  const nameOk = /\.json$/i.test(file.name)
  const mimeIsJson = (file.type || '').toLowerCase().includes('json')
  if (!nameOk && !mimeIsJson) {
    const got = file.name || file.type || 'unknown'
    return { ok: false, reason: `Expected a .json file (got ${got}).` }
  }
  return { ok: true }
}
