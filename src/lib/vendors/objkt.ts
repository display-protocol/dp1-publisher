/**
 * objkt client for "Load from series", against the public objkt GraphQL API
 * (no auth; CORS open).
 *
 * A "release" on objkt is one FA2 contract, so the curator's slug is the KT1
 * address. Only `collection_type: "custom"` contracts are accepted: those are
 * single-artist collections whose token ids run from 1 and double as mint
 * numbers. Shared contracts (`open`, `open_generative` — hic et nunc, fxhash)
 * hold hundreds of thousands of tokens by many artists and are refused with a
 * clear error, as the indexer did.
 */

import type { MintSpec } from '@/lib/mintSpec'
import { graphqlRequest, VendorAPIError } from './http'
import { resolveIpfsUri } from './ipfs'
import { finalizeTokens } from './tokens'
import {
  LOAD_ALL_CAP,
  VENDOR_OBJKT,
  type VendorLoadResult,
  type VendorRelease,
  type VendorToken,
} from './types'

export const OBJKT_GRAPHQL_URL = 'https://data.objkt.com/v3/graphql'
/**
 * Hard server cap: a larger `limit` silently returns 500 rows with no error, so
 * pagination must use exactly this size and stop on a short page — never on an
 * error that will not come.
 */
export const OBJKT_PAGE_SIZE = 500
/** Token ids per `_in` request when a mint spec is given. */
export const OBJKT_TOKEN_ID_BATCH_SIZE = 100
/**
 * `flag` values that mean objkt has taken the token down. "flagged" is an
 * unactioned report and passes, as do null and unknown values (fail-open, same
 * as the indexer's moderation rule).
 */
export const OBJKT_TAKEDOWN_FLAGS: ReadonlySet<string> = new Set(['banned', 'removed'])

const KT1_ADDRESS = /^KT1[1-9A-HJ-NP-Za-km-z]{33}$/
// token_id is a string column on objkt and FA2 allows ids beyond 2^53. Custom
// collections never use them, but a wider id cannot be a safe mint number.
const SAFE_TOKEN_ID = /^\d{1,15}$/

export interface ObjktCollection {
  name: string | null
  /** Sum of supply across tokens — not a token count (an edition of 100 counts 100). */
  editions: number | null
  /** Distinct tokens in the contract. */
  items: number | null
  collection_type: string | null
}

export interface ObjktTokenRow {
  token_id: string
  name: string | null
  artifact_uri: string | null
  display_uri: string | null
  mime: string | null
  flag: string | null
}

const RESOLVE_COLLECTION_QUERY = `
query ResolveCollection($contract: String!) {
  fa(where: {contract: {_eq: $contract}}) {
    name editions items collection_type
  }
}`

const COLLECTION_TOKENS_QUERY = `
query CollectionTokens($contract: String!, $limit: Int!, $offset: Int!) {
  token(
    where: {fa_contract: {_eq: $contract}}
    order_by: {pk: asc}
    limit: $limit
    offset: $offset
  ) {
    token_id name artifact_uri display_uri mime flag
  }
}`

const COLLECTION_TOKENS_BY_ID_QUERY = `
query CollectionTokensByIds($contract: String!, $ids: [String!]!, $limit: Int!) {
  token(where: {fa_contract: {_eq: $contract}, token_id: {_in: $ids}}, limit: $limit) {
    token_id name artifact_uri display_uri mime flag
  }
}`

export function isObjktContract(slug: string): boolean {
  return KT1_ADDRESS.test(slug)
}

export async function resolveObjktCollection(contract: string): Promise<ObjktCollection> {
  const data = await graphqlRequest<{ fa: ObjktCollection[] }>(
    VENDOR_OBJKT,
    OBJKT_GRAPHQL_URL,
    RESOLVE_COLLECTION_QUERY,
    { contract }
  )
  const collection = data.fa?.[0]
  if (!collection) {
    throw new VendorAPIError(
      `objkt does not know the contract ${contract}.`,
      VENDOR_OBJKT,
      'not_found'
    )
  }
  if (collection.collection_type !== 'custom') {
    const label = collection.name?.trim() || contract
    throw new VendorAPIError(
      `objkt collection "${label}" is a ${collection.collection_type ?? 'shared'} contract; ` +
        'only custom (single-artist) contracts can be loaded as a series.',
      VENDOR_OBJKT,
      'unsupported'
    )
  }
  return collection
}

/**
 * Map one token row. `artifact_uri` is the playable artifact and `display_uri` the
 * still, matching the indexer's animation-then-image preference; a non-https
 * artifact falls back to the display. Taken-down tokens
 * are returned with `excluded` so gap detection still counts them. Returns null
 * only when token_id cannot serve as a mint number.
 */
export function objktTokenToToken(contract: string, row: ObjktTokenRow): VendorToken | null {
  if (!SAFE_TOKEN_ID.test(row.token_id)) return null
  // First candidate that resolves to https wins: an artifact on onchfs:// or ar://
  // would be dropped as a source, so the display still keeps the token playable.
  const source =
    [row.artifact_uri, row.display_uri]
      .map((uri) => (uri?.trim() ? resolveIpfsUri(uri) : null))
      .find((uri) => uri?.startsWith('https://')) ?? null
  const token: VendorToken = {
    vendor: VENDOR_OBJKT,
    mintNumber: Number(row.token_id),
    chain: 'tezos',
    standard: 'fa2',
    contractAddress: contract,
    tokenId: row.token_id,
    title: row.name?.trim() || null,
    source,
  }
  if (row.flag && OBJKT_TAKEDOWN_FLAGS.has(row.flag)) token.excluded = 'moderated'
  return token
}

async function fetchTokenRows(
  contract: string,
  variables: Record<string, unknown>,
  query: string
): Promise<ObjktTokenRow[]> {
  const data = await graphqlRequest<{ token: ObjktTokenRow[] }>(
    VENDOR_OBJKT,
    OBJKT_GRAPHQL_URL,
    query,
    { contract, ...variables }
  )
  return data.token ?? []
}

export async function loadObjktRelease(
  slug: string,
  mintSpec: MintSpec | null
): Promise<VendorLoadResult> {
  if (!isObjktContract(slug)) {
    throw new VendorAPIError(
      'objkt releases are identified by their KT1 contract address (objkt.com/collections/<KT1…>).',
      VENDOR_OBJKT,
      'unsupported'
    )
  }
  const collection = await resolveObjktCollection(slug)
  const release: VendorRelease = {
    vendor: VENDOR_OBJKT,
    slug,
    name: collection.name?.trim() || null,
    // `editions` is summed supply, not a token count, so it is no fallback.
    totalMints: collection.items ?? null,
  }

  const tokens: VendorToken[] = []
  let wasCapped = false

  if (mintSpec) {
    for (let i = 0; i < mintSpec.length; i += OBJKT_TOKEN_ID_BATCH_SIZE) {
      const ids = mintSpec.slice(i, i + OBJKT_TOKEN_ID_BATCH_SIZE).map((n) => String(n))
      const rows = await fetchTokenRows(
        slug,
        { ids, limit: ids.length },
        COLLECTION_TOKENS_BY_ID_QUERY
      )
      for (const row of rows) {
        const token = objktTokenToToken(slug, row)
        if (token) tokens.push(token)
      }
    }
  } else {
    // `pk: asc` is only a stable page order (insertion order on objkt's side);
    // mint order comes from the numeric sort in finalizeTokens.
    let offset = 0
    let fetched = 0
    let exhausted = false
    while (fetched < LOAD_ALL_CAP) {
      const limit = Math.min(OBJKT_PAGE_SIZE, LOAD_ALL_CAP - fetched)
      const rows = await fetchTokenRows(slug, { limit, offset }, COLLECTION_TOKENS_QUERY)
      fetched += rows.length
      for (const row of rows) {
        const token = objktTokenToToken(slug, row)
        if (token) tokens.push(token)
      }
      if (rows.length < limit) {
        exhausted = true
        break
      }
      offset += rows.length
    }
    const total = collection.items
    wasCapped = !exhausted && (total == null || total > fetched)
  }

  return { release, tokens: finalizeTokens(tokens), wasCapped, uncheckedMints: [] }
}
