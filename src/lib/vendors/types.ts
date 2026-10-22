/**
 * Shared shapes for the vendor clients behind "Load from series".
 *
 * Each vendor module (feralfile, artblocks, objkt) resolves a release by the
 * curator's slug and returns tokens in this common form, so the component and
 * the playlist-item mapper never see vendor-specific JSON. Everything here is
 * compose-time, read-only data: nothing is written to any vendor.
 */

import { MINT_SPEC_MAX_SIZE } from '@/lib/mintSpec'

export const VENDOR_FERALFILE = 'feralfile'
export const VENDOR_ARTBLOCKS = 'artblocks'
export const VENDOR_OBJKT = 'objkt'

export type Vendor = typeof VENDOR_FERALFILE | typeof VENDOR_ARTBLOCKS | typeof VENDOR_OBJKT

/** Dropdown order. fxhash was dropped when the service went down; only these three are supported. */
export const VENDORS: readonly Vendor[] = [VENDOR_FERALFILE, VENDOR_ARTBLOCKS, VENDOR_OBJKT]

export const VENDOR_LABELS: Record<Vendor, string> = {
  [VENDOR_FERALFILE]: 'Feral File',
  [VENDOR_ARTBLOCKS]: 'Art Blocks',
  [VENDOR_OBJKT]: 'objkt',
}

/**
 * Ceiling for a load-all walk (no mint spec). Equals MINT_SPEC_MAX_SIZE so "all"
 * and "1..N" share one bound on browser-side requests and memory. A release larger
 * than this loads its first LOAD_ALL_CAP mints and reports `wasCapped`.
 */
export const LOAD_ALL_CAP = MINT_SPEC_MAX_SIZE

export interface VendorRelease {
  vendor: Vendor
  /** The curator's input, trimmed (Feral File series slug, Art Blocks project slug, objkt KT1). */
  slug: string
  name: string | null
  /** Vendor-reported release size, when the vendor exposes one. Display only. */
  totalMints: number | null
}

export interface VendorToken {
  vendor: Vendor
  /**
   * 1-based position in the release. Feral File: artwork index + 1. Art Blocks:
   * invocation + 1. objkt: Number(token_id) — custom contracts mint from 1 by
   * convention, so token_id doubles as the mint number.
   */
  mintNumber: number
  chain: 'evm' | 'tezos'
  standard: 'erc721' | 'fa2'
  /** EVM: EIP-55 checksummed. Tezos: KT1… verbatim. */
  contractAddress: string
  /** Decimal token id as the vendor reports it; never recomputed. */
  tokenId: string
  title: string | null
  /**
   * Playable https URL, already normalized by the vendor module (CDN rewrite,
   * IPFS gateway). Null when the vendor exposes no renderable media for the token,
   * or only a non-https one (enforced in finalizeTokens).
   */
  source: string | null
  /**
   * Present on tokens the vendor has taken down (objkt flag banned/removed). They
   * are returned, not dropped, so gap detection counts them as existing; the mapper
   * refuses to turn them into playlist items.
   */
  excluded?: 'moderated'
}

export interface VendorLoadResult {
  release: VendorRelease
  /** Sorted by mintNumber ascending, deduplicated by contract + tokenId, https sources only. */
  tokens: VendorToken[]
  /**
   * True only on a load-all walk that stopped at LOAD_ALL_CAP while the vendor
   * reports (or may hold) more tokens. Always false with a mint spec.
   */
  wasCapped: boolean
  /**
   * Requested mints the loader never checked because it hit its request bound
   * (only Feral File, whose API cannot filter by index). Unknown, not absent: the
   * panel must keep them out of the "not found" list. Empty for other vendors.
   */
  uncheckedMints: number[]
}
