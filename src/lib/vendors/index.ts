/**
 * Entry point for "Load from series": resolve a vendor release by slug and list
 * its tokens, directly from the vendor's public API in the browser.
 *
 * This replaced the ff-indexer-v2 GraphQL path (feral-file/feral-file#3576,
 * step 4). There is no indexing step any more: a mint the vendor does not list
 * is reported to the curator as a gap, never queued for indexing. Every request
 * is read-only, and loaders issue requests sequentially — Art Blocks rate-limits
 * at a few requests per second and objkt is shared infrastructure — so a load is
 * at most ~10 requests even at the LOAD_ALL_CAP.
 */

import type { MintSpec } from '@/lib/mintSpec'
import { loadArtBlocksRelease } from './artblocks'
import { loadFeralFileRelease } from './feralfile'
import { loadObjktRelease } from './objkt'
import {
  VENDOR_ARTBLOCKS,
  VENDOR_FERALFILE,
  VENDOR_OBJKT,
  type Vendor,
  type VendorLoadResult,
} from './types'

export * from './types'
export { VendorAPIError, type VendorErrorCode } from './http'

export function loadVendorRelease(
  vendor: Vendor,
  slug: string,
  mintSpec: MintSpec | null
): Promise<VendorLoadResult> {
  const trimmed = slug.trim()
  switch (vendor) {
    case VENDOR_FERALFILE:
      return loadFeralFileRelease(trimmed, mintSpec)
    case VENDOR_ARTBLOCKS:
      return loadArtBlocksRelease(trimmed, mintSpec)
    case VENDOR_OBJKT:
      return loadObjktRelease(trimmed, mintSpec)
  }
}
