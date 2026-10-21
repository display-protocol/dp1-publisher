import type { VendorToken } from './types'

/**
 * Item sources must be https. A series replaces the whole playlist, and the publish
 * gate (validateItemSourceURI) would only reject a data:, ar:, onchfs: or http:
 * source after that, blocking the publish over one token. Dropping the source here
 * makes such a token count as "no renderable URL" in the preview instead.
 */
function httpsOrNull(source: string | null): string | null {
  if (!source) return null
  try {
    return new URL(source).protocol === 'https:' ? source : null
  } catch {
    return null
  }
}

/**
 * Final ordering contract for every vendor loader: keep https sources only,
 * deduplicate by contract + tokenId (first occurrence wins; a Feral File series
 * can span an Ethereum and a Tezos contract) and sort by mintNumber ascending.
 *
 * Sorting client-side is deliberate rather than trusting vendor order: objkt's
 * token_id is a string column, so its server-side ordering is lexicographic
 * ("1", "10", "2"), and a sparse mint spec is fetched in batches whose results
 * only interleave correctly after a sort.
 */
export function finalizeTokens(tokens: VendorToken[]): VendorToken[] {
  const seen = new Set<string>()
  const unique: VendorToken[] = []
  for (const token of tokens) {
    const key = `${token.contractAddress}:${token.tokenId}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push({ ...token, source: httpsOrNull(token.source) })
  }
  unique.sort((a, b) => a.mintNumber - b.mintNumber)
  return unique
}
