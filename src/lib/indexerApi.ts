/**
 * ff-indexer-v2 GraphQL client (browser).
 * Base URL mirrors feed client pattern: VITE_INDEXER_BASE_URL + /graphql.
 *
 * Vendor support: feralfile, artblocks, fxhash, objkt.
 * All token and indexing queries use slug-based identification (vendor_release_slug).
 * The tokens query and triggerReleaseIndexing mutation accept sparse mint_numbers lists
 * (max 50 per request) rather than mint_from/mint_to ranges — callers batch accordingly.
 */

export const INDEXER_VENDOR_FERALFILE = 'feralfile'
export const INDEXER_VENDOR_ARTBLOCKS = 'artblocks'
export const INDEXER_VENDOR_FXHASH = 'fxhash'
export const INDEXER_VENDOR_OBJKT = 'objkt'

/** GraphQL Uint8 max for paginated token list requests. */
export const MAX_RELEASE_TOKENS = 255

/**
 * Max mint numbers per tokens query or triggerReleaseIndexing mutation call.
 * The indexer enforces this server-side; callers must batch larger lists.
 */
export const MINT_NUMBERS_BATCH_SIZE = 50

/**
 * Max total mints that parseMintSpec will expand from a range input (e.g. "1..1000").
 * Guards against accidental runaway expansion.
 */
export const MINT_SPEC_MAX_SIZE = 1000

/** Release metadata returned by the releases query. */
export interface IndexerReleaseSummary {
  id: number
  vendor: string
  vendor_release_id: string
  /** URL slug from the vendor's website. Null when not yet enriched. For objkt equals vendor_release_id. */
  vendor_release_slug: string | null
  name: string | null
  total_mints: number | null
}

export interface IndexerTokenDisplay {
  animation_url: string | null
  image_url: string | null
}

export interface IndexerToken {
  id: number
  chain: string
  standard: string
  contract_address: string
  token_number: string
  release_id: number | null
  mint_number: number | null
  // viewable and burned come from the indexer schema (Boolean!) and are used
  // to prevent non-viewable or burned tokens from entering playlist construction.
  // include_unviewable: true is still requested so these tokens are visible for
  // gap detection and Phase 2 polling — we need to know they are indexed even
  // when they are not yet viewable or have been burned.
  viewable: boolean
  burned: boolean
  display: IndexerTokenDisplay | null
  metadata: { name: string | null } | null
}

/** Result returned by triggerReleaseIndexing. */
export interface IndexerTriggerResult {
  job_id: number
}

/**
 * Result shape returned by fetchTokensByVendorSlug.
 *
 * wasCapped is only ever true on the unfiltered-load (no-mintSpec) path and signals
 * that the client deliberately stopped fetching at MINT_SPEC_MAX_SIZE even though
 * the release may contain more indexed tokens. This is distinct from partial
 * server-side indexing (where the indexer has not yet processed all mints).
 */
export interface TokenFetchResult {
  tokens: IndexerToken[]
  wasCapped: boolean
}

/**
 * Job status shape from jobStatus(job_id).
 * status values: "pending" | "running" | "succeeded" | "failed" | "canceled"
 */
export interface IndexerJobStatus {
  job_id: number
  status: string
  last_error: string | null
  execution_time_ms: number | null
}

/**
 * Explicit sorted array of 1-based mint numbers derived from user input.
 * Used as the wire value for tokens(mint_numbers) and triggerReleaseIndexing(mint_numbers).
 */
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

/** Base indexer origin, no trailing slash (matches `VITE_INDEXER_BASE_URL` when set). */
export function getIndexerBaseUrl(): string {
  return String(import.meta.env.VITE_INDEXER_BASE_URL || 'https://indexer.feralfile.com').replace(
    /\/$/,
    ''
  )
}

function graphqlUrl(): string {
  return `${getIndexerBaseUrl()}/graphql`
}

export class IndexerAPIError extends Error {
  constructor(
    message: string,
    public status?: number
  ) {
    super(message)
    this.name = 'IndexerAPIError'
  }
}


interface GraphQLResponse<T> {
  data?: T
  errors?: Array<{ message: string }>
}

async function graphqlRequest<T>(
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const response = await fetch(graphqlUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })

  if (!response.ok) {
    throw new IndexerAPIError(
      `Indexer request failed (${response.status})`,
      response.status
    )
  }

  const body = (await response.json()) as GraphQLResponse<T>
  if (body.errors?.length) {
    throw new IndexerAPIError(body.errors.map((e) => e.message).join('; '))
  }
  if (!body.data) {
    throw new IndexerAPIError('Indexer returned no data')
  }
  return body.data
}

// ---------------------------------------------------------------------------
// Release resolution
// ---------------------------------------------------------------------------

const RESOLVE_RELEASE_BY_SLUG_QUERY = `
  query ResolveReleaseBySlug($vendor: String!, $slug: String!) {
    releases(vendor: $vendor, vendor_release_slug: $slug, limit: 1) {
      items {
        id
        vendor
        vendor_release_id
        vendor_release_slug
        name
        total_mints
      }
    }
  }
`

/** Resolve a release by vendor slug. Returns null when not found. */
export async function resolveReleaseBySlug(
  vendor: string,
  slug: string
): Promise<IndexerReleaseSummary | null> {
  const data = await graphqlRequest<{
    releases: { items: IndexerReleaseSummary[] }
  }>(RESOLVE_RELEASE_BY_SLUG_QUERY, { vendor, slug: slug.trim() })

  return data.releases.items[0] ?? null
}

// ---------------------------------------------------------------------------
// Token fetching
// ---------------------------------------------------------------------------

/**
 * Paginated token fetch without a mint filter. Iterates offset pages until
 * TokenList.offset is null (no more pages).
 */
const TOKENS_BY_VENDOR_SLUG_QUERY = `
  query TokensByVendorSlug(
    $vendor: String!, $slug: String!, $limit: Uint8!, $offset: Uint64
  ) {
    tokens(
      release_vendor: $vendor
      release_vendor_slug: $slug
      sort_by: mint_number
      sort_order: asc
      include_unviewable: true
      limit: $limit
      offset: $offset
    ) {
      items {
        id
        chain
        standard
        contract_address
        token_number
        release_id
        mint_number
        viewable
        burned
        display { animation_url image_url }
        metadata { name }
      }
      offset
    }
  }
`

/**
 * Batched token fetch for a specific set of mint numbers.
 * One request per batch of MINT_NUMBERS_BATCH_SIZE; results are merged.
 */
const TOKENS_BY_MINT_NUMBERS_QUERY = `
  query TokensByMintNumbers(
    $vendor: String!, $slug: String!, $mintNumbers: [Int!]!, $limit: Uint8!
  ) {
    tokens(
      release_vendor: $vendor
      release_vendor_slug: $slug
      mint_numbers: $mintNumbers
      sort_by: mint_number
      sort_order: asc
      include_unviewable: true
      limit: $limit
    ) {
      items {
        id
        chain
        standard
        contract_address
        token_number
        release_id
        mint_number
        viewable
        burned
        display { animation_url image_url }
        metadata { name }
      }
      offset
    }
  }
`

async function fetchTokensBatchByMintNumbers(
  vendor: string,
  slug: string,
  mintNumbers: number[]
): Promise<IndexerToken[]> {
  const data = await graphqlRequest<{ tokens: { items: IndexerToken[] } }>(
    TOKENS_BY_MINT_NUMBERS_QUERY,
    { vendor, slug, mintNumbers, limit: MINT_NUMBERS_BATCH_SIZE }
  )
  return data.tokens.items
}

/**
 * Fetch tokens for a vendor release by slug.
 *
 * - Without mintSpec: paginates through all tokens (offset-based, 255/page), capped at
 *   MINT_SPEC_MAX_SIZE. Returns wasCapped=true when the loop was stopped by the cap
 *   rather than by natural exhaustion of the release. This is distinct from the
 *   server-side partial-indexing case (where the indexer simply hasn't processed all
 *   mints yet) and must be surfaced differently in the UI.
 * - With mintSpec: issues one request per batch of ≤50 mint numbers in parallel,
 *   merges results, and deduplicates by token id. wasCapped is always false here.
 *   Use this for gap polling after triggerReleaseIndexing.
 *
 * include_unviewable is always true so partially-indexed tokens are visible.
 */
export async function fetchTokensByVendorSlug(
  vendor: string,
  slug: string,
  mintSpec?: MintSpec
): Promise<TokenFetchResult> {
  if (mintSpec) {
    // Split into batches and issue parallel requests.
    const batches: number[][] = []
    for (let i = 0; i < mintSpec.length; i += MINT_NUMBERS_BATCH_SIZE) {
      batches.push(mintSpec.slice(i, i + MINT_NUMBERS_BATCH_SIZE))
    }
    const batchResults = await Promise.all(
      batches.map((batch) => fetchTokensBatchByMintNumbers(vendor, slug, batch))
    )
    // Flatten and deduplicate by token id (shouldn't overlap but guard anyway).
    const seen = new Set<number>()
    const merged: IndexerToken[] = []
    for (const tokens of batchResults) {
      for (const token of tokens) {
        if (!seen.has(token.id)) {
          seen.add(token.id)
          merged.push(token)
        }
      }
    }
    // Re-sort by mint_number ascending after merge.
    merged.sort((a, b) => (a.mint_number ?? 0) - (b.mint_number ?? 0))
    return { tokens: merged, wasCapped: false }
  }

  // No mint filter — paginate through all tokens for the release, capped at
  // MINT_SPEC_MAX_SIZE total. Without this cap, a large fxhash/objkt collection
  // could trigger dozens of requests and accumulate thousands of objects in browser
  // memory with no user-visible indication.
  //
  // We track whether the loop exited because we hit MINT_SPEC_MAX_SIZE (wasCapped=true)
  // vs. because the server returned no more pages (wasCapped=false). The caller must
  // surface these differently: cap = "client stopped early, use a mint range for full
  // coverage"; partial server indexing = "indexer hasn't processed all mints yet".
  type TokenPage = { tokens: { items: IndexerToken[]; offset: number | null } }
  const allTokens: IndexerToken[] = []
  let pageOffset: number | null = null
  // Track whether the loop exited because the server had no more pages (true)
  // vs. because the client hit MINT_SPEC_MAX_SIZE (false).
  //
  // We limit each page request to the remaining capacity (MINT_SPEC_MAX_SIZE - accumulated)
  // rather than always requesting MAX_RELEASE_TOKENS. Without this, the final page could
  // push allTokens past MINT_SPEC_MAX_SIZE while also returning offset:null (natural
  // exhaustion), causing the subsequent slice to silently drop the overshoot while
  // naturallyExhausted=true makes wasCapped appear false. Capping the limit prevents that
  // overshoot entirely so naturallyExhausted correctly reflects whether all tokens were
  // returned vs. the client stopped early.
  let naturallyExhausted = false
  while (allTokens.length < MINT_SPEC_MAX_SIZE) {
    const remaining = MINT_SPEC_MAX_SIZE - allTokens.length
    const limit = Math.min(MAX_RELEASE_TOKENS, remaining)
    const page: TokenPage = await graphqlRequest<TokenPage>(
      TOKENS_BY_VENDOR_SLUG_QUERY,
      { vendor, slug, limit, offset: pageOffset }
    )
    allTokens.push(...page.tokens.items)
    if (page.tokens.offset == null || page.tokens.items.length === 0) {
      naturallyExhausted = true
      break
    }
    pageOffset = page.tokens.offset
  }
  // Safety-net slice in case the server ignores the limit; with the remaining-capacity
  // calculation above this should be a no-op for a well-behaved server.
  const tokens = allTokens.slice(0, MINT_SPEC_MAX_SIZE)
  // wasCapped is true only when the loop exited via the while condition (cap hit),
  // not when it broke because the server returned a null offset (natural exhaustion).
  const wasCapped = !naturallyExhausted
  return { tokens, wasCapped }
}

// ---------------------------------------------------------------------------
// Release indexing mutation
// ---------------------------------------------------------------------------

const TRIGGER_RELEASE_INDEXING_MUTATION = `
  mutation TriggerRelease($vendor: String!, $slug: String!, $mintNumbers: [Int!]!) {
    triggerReleaseIndexing(
      vendor: $vendor
      vendor_release_slug: $slug
      mint_numbers: $mintNumbers
    ) {
      job_id
    }
  }
`

/**
 * Trigger indexing for a single batch of mint numbers (max MINT_NUMBERS_BATCH_SIZE).
 * Phase 1 (CID derivation + fan-out) runs asynchronously; poll job status with the
 * returned job_id. After Phase 1 succeeds, poll tokens(mint_numbers) to track completion.
 *
 * Trust boundary: this is a browser-originated write issued at curator request with no
 * client-side auth token. Abuse resistance (rate limiting, API-key enforcement, etc.) is
 * assumed to be provided by the ff-indexer-v2 server on this mutation endpoint. If the
 * indexer does not enforce a rate limit, a curator with access to the UI can submit
 * arbitrarily many jobs. Confirm the server-side policy before exposing this to untrusted
 * users. Also see the MINT_SPEC_MAX_SIZE cap in parseMintSpec which bounds the fan-out.
 */
export async function triggerReleaseIndexing(
  vendor: string,
  slug: string,
  mintNumbers: number[]
): Promise<IndexerTriggerResult> {
  const data = await graphqlRequest<{ triggerReleaseIndexing: IndexerTriggerResult }>(
    TRIGGER_RELEASE_INDEXING_MUTATION,
    { vendor, slug, mintNumbers }
  )
  return data.triggerReleaseIndexing
}

/**
 * Result from triggerReleaseIndexingBatched.
 *
 * jobIds: job_id for every batch that succeeded (may be a subset of all batches).
 * submittedMints: the mint numbers whose batches succeeded — Phase 2 should poll
 *   and complete against this set only. Mints in gapMints but absent here were
 *   never submitted and can be retried immediately after Phase 2 finishes.
 * partialError: set when at least one batch failed; the caller should poll the
 *   available jobIds, surface the partial note, and leave unsubmitted gaps visible.
 */
export interface BatchedTriggerResult {
  jobIds: number[]
  submittedMints: number[]
  partialError: string | null
}

/**
 * Trigger indexing for an arbitrary number of gap mint numbers.
 * Splits into batches of ≤MINT_NUMBERS_BATCH_SIZE and fires one mutation per batch
 * sequentially (to avoid overwhelming the indexer).
 *
 * On partial failure (batch N succeeds, batch N+1 fails), returns the job IDs and
 * submittedMints for successful batches so the caller can poll only those mints in
 * Phase 2. Without submittedMints, Phase 2 would poll the full gapMints set and
 * time out waiting for mints that were never submitted to the indexer.
 */
export async function triggerReleaseIndexingBatched(
  vendor: string,
  slug: string,
  mintNumbers: number[]
): Promise<BatchedTriggerResult> {
  const jobIds: number[] = []
  const submittedMints: number[] = []
  let partialError: string | null = null
  for (let i = 0; i < mintNumbers.length; i += MINT_NUMBERS_BATCH_SIZE) {
    const batch = mintNumbers.slice(i, i + MINT_NUMBERS_BATCH_SIZE)
    try {
      const result = await triggerReleaseIndexing(vendor, slug, batch)
      jobIds.push(result.job_id)
      submittedMints.push(...batch)
    } catch (e) {
      partialError = e instanceof Error ? e.message : 'Failed to submit indexing batch.'
      break
    }
  }
  return { jobIds, submittedMints, partialError }
}

// ---------------------------------------------------------------------------
// Job status polling
// ---------------------------------------------------------------------------

const JOB_STATUS_QUERY = `
  query JobStatus($jobId: Int!) {
    jobStatus(job_id: $jobId) {
      job_id
      status
      last_error
      execution_time_ms
    }
  }
`

/** Fetch the current status of an indexing job. Returns null if the job is not found. */
export async function fetchJobStatus(jobId: number): Promise<IndexerJobStatus | null> {
  const data = await graphqlRequest<{ jobStatus: IndexerJobStatus | null }>(
    JOB_STATUS_QUERY,
    { jobId }
  )
  return data.jobStatus
}

