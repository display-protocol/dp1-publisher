/**
 * Curator-facing mint-number spec for "Load from series".
 *
 * Vendor-agnostic: a mint number is the 1-based position of a token inside its
 * release (Feral File artwork index + 1, Art Blocks invocation + 1, objkt
 * token_id). Each vendor client in `src/lib/vendors/` translates the spec into
 * its own filter; this module only parses and bounds the curator's input.
 */

/**
 * Max total mints that parseMintSpec will expand from a range input (e.g. "1..1000").
 * Also the ceiling for a load-all walk (`LOAD_ALL_CAP` in `vendors/types.ts`), so a
 * range and "all" share one bound on browser-side fan-out and memory.
 */
export const MINT_SPEC_MAX_SIZE = 1000

/** Explicit sorted array of 1-based mint numbers derived from user input. */
export type MintSpec = number[]

/** Thrown by parseMintSpec when the input cannot be interpreted as valid mint numbers. */
export class MintSpecParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MintSpecParseError'
  }
}

/**
 * Parse a curator-supplied mint input string into a sorted, deduplicated array of
 * 1-based mint numbers, or null when the input is empty (meaning "no filter, fetch all").
 *
 * Accepted formats:
 *   ""         → null
 *   "50"       → [50]
 *   "1..100"   → [1, 2, 3, ..., 100]  (inclusive range, expands inline)
 *   "1,3,5"    → [1, 3, 5]            (explicit sparse list)
 *
 * Throws MintSpecParseError for:
 *   - non-integer values
 *   - mint numbers < 1
 *   - reversed ranges (e.g. "5..1")
 *   - expanded range > MINT_SPEC_MAX_SIZE entries
 */
export function parseMintSpec(input: string): MintSpec | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  // Range notation: "N..M"
  if (trimmed.includes('..')) {
    const parts = trimmed.split('..')
    if (parts.length !== 2) {
      throw new MintSpecParseError(`Invalid range format: "${trimmed}". Use "1..100".`)
    }
    const from = parseInt(parts[0], 10)
    const to = parseInt(parts[1], 10)
    if (!Number.isInteger(from) || isNaN(from) || String(from) !== parts[0].trim()) {
      throw new MintSpecParseError(`Invalid range start: "${parts[0]}".`)
    }
    if (!Number.isInteger(to) || isNaN(to) || String(to) !== parts[1].trim()) {
      throw new MintSpecParseError(`Invalid range end: "${parts[1]}".`)
    }
    if (from < 1) {
      throw new MintSpecParseError(`Mint numbers must be ≥ 1 (got ${from}).`)
    }
    if (to < from) {
      throw new MintSpecParseError(`Range end must be ≥ start (got ${from}..${to}).`)
    }
    const count = to - from + 1
    if (count > MINT_SPEC_MAX_SIZE) {
      throw new MintSpecParseError(
        `Range "${trimmed}" expands to ${count} mints; max is ${MINT_SPEC_MAX_SIZE}.`
      )
    }
    return Array.from({ length: count }, (_, i) => from + i)
  }

  // Comma-separated list (or single number)
  const rawParts = trimmed.split(',')
  const seen = new Set<number>()
  const result: number[] = []
  for (const part of rawParts) {
    const val = parseInt(part.trim(), 10)
    if (isNaN(val) || String(val) !== part.trim()) {
      throw new MintSpecParseError(`"${part.trim()}" is not a valid mint number.`)
    }
    if (val < 1) {
      throw new MintSpecParseError(`Mint numbers must be ≥ 1 (got ${val}).`)
    }
    if (seen.has(val)) {
      throw new MintSpecParseError(`Duplicate mint number: ${val}.`)
    }
    seen.add(val)
    result.push(val)
  }
  // Apply the same total-size cap as ranges to bound browser-side fan-out.
  if (result.length > MINT_SPEC_MAX_SIZE) {
    throw new MintSpecParseError(
      `Explicit list contains ${result.length} mints; max is ${MINT_SPEC_MAX_SIZE}.`
    )
  }
  result.sort((a, b) => a - b)
  return result
}
