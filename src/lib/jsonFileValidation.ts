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
 * - MIME hints JSON / plain text (browsers occasionally report an empty
 *   `file.type` on drop; we treat empty as inconclusive and fall back to the
 *   name check rather than rejecting).
 */
export function validateJsonFile(file: File): JsonFileValidation {
  if (file.size > MAX_JSON_FILE_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1)
    const cap = (MAX_JSON_FILE_BYTES / 1024 / 1024).toFixed(0)
    return { ok: false, reason: `File is ${mb} MB — over the ${cap} MB limit.` }
  }
  const nameOk = /\.json$/i.test(file.name)
  const type = (file.type || '').toLowerCase()
  const typeOk = type === '' || type.includes('json') || type.startsWith('text/')
  if (!nameOk && !typeOk) {
    const got = file.name || file.type || 'unknown'
    return { ok: false, reason: `Expected a .json file (got ${got}).` }
  }
  return { ok: true }
}
