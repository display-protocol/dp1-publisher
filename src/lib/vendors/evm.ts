import { getAddress, isAddress } from 'viem'

/**
 * EIP-55 checksum an EVM contract address, or null when it is not an address.
 *
 * Vendors disagree on case (Feral File returns checksummed, Art Blocks lowercase).
 * Provenance in a playlist should not depend on which vendor a token came from,
 * and the indexer-backed items this replaces were checksummed, so every EVM
 * address is normalized here. `strict: false` accepts any case on input.
 */
export function checksumEvmAddress(address: string): string | null {
  const trimmed = address.trim()
  if (!isAddress(trimmed, { strict: false })) return null
  return getAddress(trimmed)
}
