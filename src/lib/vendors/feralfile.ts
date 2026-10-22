/**
 * Feral File public API client for "Load from series".
 *
 * Endpoints (GET, no auth): `/series?slug=` resolves the curator's slug to a
 * series, `/artworks?seriesID=` lists its artworks in mint order. One list call
 * already carries chain, contract, token id and preview URI per artwork, so no
 * per-token request is needed.
 *
 * CORS: feralfile.com answers 403 to any Origin it has not allow-listed.
 * publisher.feralfile.com is allow-listed (production calls the API directly);
 * localhost is not, so the dev server proxies `/ff-api` → feralfile.com/api and
 * strips the Origin header (see vite.config.ts).
 */

import type { MintSpec } from '@/lib/mintSpec'
import { checksumEvmAddress } from './evm'
import { fetchJson, VendorAPIError } from './http'
import { finalizeTokens } from './tokens'
import {
  LOAD_ALL_CAP,
  VENDOR_FERALFILE,
  type VendorLoadResult,
  type VendorRelease,
  type VendorToken,
} from './types'

export const DEFAULT_FERALFILE_API_BASE_URL = 'https://feralfile.com/api'
/** Dev-server proxy prefix; must match `server.proxy` in vite.config.ts. */
export const FERALFILE_DEV_PROXY_PATH = '/ff-api'
/** Page size the indexer has used against this endpoint for years; the API accepts ~300. */
export const FERALFILE_ARTWORKS_PAGE_SIZE = 100
/**
 * Bound on pages fetched for one load. Matches LOAD_ALL_CAP for a load-all walk. A
 * mint spec jumps straight to each cluster of requested mints, so it only hits this
 * bound when the spec is spread over more than 10 distant clusters; mints left
 * unvisited are returned as `uncheckedMints`, never reported as missing.
 */
export const FERALFILE_MAX_PAGES = Math.ceil(LOAD_ALL_CAP / FERALFILE_ARTWORKS_PAGE_SIZE)

export const FERALFILE_CDN_PREFIX = 'https://cdn.artworks.feralfile.io/'
/** The old artwork CDN origin no longer resolves, but the API still emits it in places. */
export const RETIRED_FERALFILE_CDN_PREFIX = 'https://cdn.feralfileassets.com/'

/**
 * API base, no trailing slash. `VITE_FERALFILE_API_BASE_URL` wins; otherwise the
 * dev server uses the Vite proxy path and production builds call feralfile.com.
 */
export function getFeralFileApiBaseUrl(): string {
  const configured = import.meta.env.VITE_FERALFILE_API_BASE_URL
  const base =
    configured || (import.meta.env.DEV ? FERALFILE_DEV_PROXY_PATH : DEFAULT_FERALFILE_API_BASE_URL)
  return String(base).replace(/\/+$/, '')
}

export interface FeralFileSeries {
  id: string
  slug: string
  title: string
  medium?: string
  settings?: { maxArtwork?: number }
}

export interface FeralFileArtwork {
  id: string
  /** 0-based position in the series; null for artworks not yet assigned. */
  index: number | null
  name: string
  /** "ethereum" | "tezos" | "bitmark" (unswapped legacy artworks). */
  chain: string
  contractAddress: string
  tokenID: string
  previewURI: string
}

interface SeriesListResponse {
  result: FeralFileSeries[] | null
}

interface ArtworksResponse {
  result: FeralFileArtwork[] | null
  paging?: { offset?: number; limit?: number; total?: number }
}

// Mirrors the indexer's cloudflare.IsCloudflareImageURL: a Cloudflare Images URL
// with no variant segment is unrenderable as-is, so the "xl" variant is appended.
const CLOUDFLARE_IMAGE_URL =
  /^(https:\/\/imagedelivery\.net\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+)(?:\/([A-Za-z0-9_-]+))?$/
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i

/**
 * Rewrite a URL on the retired Feral File CDN to the live origin. Mirrors the
 * indexer's `MigrateFeralFileCDN`: every occurrence is replaced (CDN URLs also
 * appear inside query parameters), and a directory-style path gains `index.html`
 * because the old CDN served a directory index and the new one answers 404.
 * URLs on any other host are returned unchanged.
 */
export function migrateFeralFileCdn(url: string): string {
  const rewritten = url.split(RETIRED_FERALFILE_CDN_PREFIX).join(FERALFILE_CDN_PREFIX)
  if (!rewritten.startsWith(FERALFILE_CDN_PREFIX)) return rewritten
  let pathEnd = rewritten.search(/[?#]/)
  if (pathEnd < 0) pathEnd = rewritten.length
  if (pathEnd <= FERALFILE_CDN_PREFIX.length || rewritten[pathEnd - 1] !== '/') return rewritten
  return `${rewritten.slice(0, pathEnd)}index.html${rewritten.slice(pathEnd)}`
}

/**
 * Turn an API media URI into the playable URL, mirroring the indexer's
 * `feralfile.URL()` then the CDN migration: a relative path lives on the artwork
 * CDN, a Cloudflare Images URL needs a variant, anything else is kept. Null for
 * an empty value so the caller can treat the token as having no media.
 */
export function feralFileMediaUrl(uri: string): string | null {
  const trimmed = uri.trim()
  if (!trimmed) return null
  const cloudflare = CLOUDFLARE_IMAGE_URL.exec(trimmed)
  if (cloudflare) return cloudflare[2] ? trimmed : `${trimmed}/xl`
  const absolute =
    HAS_SCHEME.test(trimmed) || trimmed.startsWith('//')
      ? trimmed
      : `${FERALFILE_CDN_PREFIX}${trimmed.replace(/^\/+/, '')}`
  return migrateFeralFileCdn(absolute)
}

/**
 * Resolve a series slug. Slugs are not unique across exhibitions (ff-exhibition#3039);
 * the first match is taken, which is what the website and the indexer do too.
 */
export async function resolveFeralFileSeries(slug: string): Promise<FeralFileSeries> {
  const url = `${getFeralFileApiBaseUrl()}/series?slug=${encodeURIComponent(slug)}&limit=1`
  const body = await fetchJson<SeriesListResponse>(VENDOR_FERALFILE, url)
  const series = body.result?.[0]
  if (!series) {
    throw new VendorAPIError(
      `No Feral File series with slug "${slug}".`,
      VENDOR_FERALFILE,
      'not_found'
    )
  }
  return series
}

export async function fetchFeralFileArtworks(
  seriesId: string,
  offset: number,
  limit: number
): Promise<{ artworks: FeralFileArtwork[]; total: number | null }> {
  const url =
    `${getFeralFileApiBaseUrl()}/artworks?seriesID=${encodeURIComponent(seriesId)}` +
    `&sortBy=index&sortOrder=ASC&offset=${offset}&limit=${limit}`
  const body = await fetchJson<ArtworksResponse>(VENDOR_FERALFILE, url)
  return { artworks: body.result ?? [], total: body.paging?.total ?? null }
}

/**
 * Display title for an artwork, mirroring the indexer's `CanonicalName`. Edition
 * series name artworks "#1", "#2", … or "AE"/"AP"/"PP" (artist, artist-proof and
 * printer-proof editions), which mean nothing outside the series page, so those
 * are prefixed with the series title ("Data Pilgrims 01 #1"). Other names stand alone.
 */
export function feralFileArtworkTitle(name: string, seriesTitle: string | null): string | null {
  const trimmed = name?.trim()
  if (!trimmed) return null
  const needsSeries = trimmed.startsWith('#') || trimmed === 'AE' || trimmed === 'AP' || trimmed === 'PP'
  return needsSeries && seriesTitle ? `${seriesTitle} ${trimmed}` : trimmed
}

/**
 * Map one artwork row. Returns null (skip) for rows without a mint position or an
 * on-chain identity: a null index, an empty contract or token id, and chain
 * "bitmark" — a legacy artwork that has not been swapped to EVM/Tezos has no
 * contract a DP-1 provenance block could name. Same rule as the indexer.
 */
export function feralFileArtworkToToken(
  artwork: FeralFileArtwork,
  seriesTitle: string | null = null
): VendorToken | null {
  const index = artwork.index
  if (index == null || !Number.isInteger(index) || index < 0) return null
  if (!artwork.contractAddress || !artwork.tokenID) return null

  let contract: Pick<VendorToken, 'chain' | 'standard' | 'contractAddress'>
  switch (artwork.chain?.toLowerCase()) {
    case 'ethereum': {
      const address = checksumEvmAddress(artwork.contractAddress)
      if (!address) return null
      contract = { chain: 'evm', standard: 'erc721', contractAddress: address }
      break
    }
    case 'tezos':
      contract = { chain: 'tezos', standard: 'fa2', contractAddress: artwork.contractAddress }
      break
    default:
      return null
  }

  return {
    vendor: VENDOR_FERALFILE,
    mintNumber: index + 1,
    ...contract,
    tokenId: artwork.tokenID,
    title: feralFileArtworkTitle(artwork.name, seriesTitle),
    // The preview is the artwork's playable artifact for every medium (image,
    // video, software); the indexer additionally merged on-chain metadata for
    // some image series and could emit an ipfs:// animation URL instead. The CDN
    // URL is the vendor-owned one, so it is used deliberately here.
    source: feralFileMediaUrl(artwork.previewURI ?? ''),
  }
}

export async function loadFeralFileRelease(
  slug: string,
  mintSpec: MintSpec | null
): Promise<VendorLoadResult> {
  const series = await resolveFeralFileSeries(slug)
  const release: VendorRelease = {
    vendor: VENDOR_FERALFILE,
    slug,
    name: series.title?.trim() || null,
    totalMints: series.settings?.maxArtwork ?? null,
  }

  const tokens: VendorToken[] = []
  let wasCapped = false
  let uncheckedMints: number[] = []

  if (mintSpec) {
    // The API filters by offset only. Assumption (holds for every series sampled,
    // and the indexer relies on it too): with sortBy=index the offset equals the
    // 0-based index, i.e. indices are contiguous from 0. Each page starts at the
    // next requested mint, so a sparse spec such as "1,5000" costs one page per
    // cluster instead of walking every page in between.
    const wanted = new Set(mintSpec)
    let next = 0 // position in mintSpec of the first mint not yet covered
    let page = 0
    while (next < mintSpec.length && page < FERALFILE_MAX_PAGES) {
      const offset = mintSpec[next] - 1
      const { artworks } = await fetchFeralFileArtworks(
        series.id,
        offset,
        FERALFILE_ARTWORKS_PAGE_SIZE
      )
      page += 1
      for (const artwork of artworks) {
        const token = feralFileArtworkToToken(artwork, release.name)
        if (token && wanted.has(token.mintNumber)) tokens.push(token)
      }
      if (artworks.length < FERALFILE_ARTWORKS_PAGE_SIZE) {
        // Past the end of the series: every remaining mint is checked and absent.
        next = mintSpec.length
        break
      }
      const coveredThrough = offset + artworks.length // highest 1-based mint covered
      while (next < mintSpec.length && mintSpec[next] <= coveredThrough) next += 1
    }
    // Mints the page bound never reached: unknown, not absent. The panel must not
    // tell the curator they do not exist on Feral File.
    uncheckedMints = mintSpec.slice(next)
  } else {
    let offset = 0
    let fetched = 0
    let exhausted = false
    let total: number | null = null
    while (fetched < LOAD_ALL_CAP) {
      // Shrink the last page to the remaining capacity so the cap is never
      // overshot; otherwise a full final page could not be told apart from a
      // truncated one.
      const limit = Math.min(FERALFILE_ARTWORKS_PAGE_SIZE, LOAD_ALL_CAP - fetched)
      const page = await fetchFeralFileArtworks(series.id, offset, limit)
      total = page.total ?? total
      fetched += page.artworks.length
      for (const artwork of page.artworks) {
        const token = feralFileArtworkToToken(artwork, release.name)
        if (token) tokens.push(token)
      }
      if (page.artworks.length < limit) {
        exhausted = true
        break
      }
      offset += page.artworks.length
    }
    if (release.totalMints == null) release.totalMints = total
    wasCapped = !exhausted && (total == null || total > fetched)
  }

  return { release, tokens: finalizeTokens(tokens), wasCapped, uncheckedMints }
}
