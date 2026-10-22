/**
 * Art Blocks client for "Load from series", against the public Hasura GraphQL
 * endpoint (no auth; CORS open; roughly 5 requests/second tolerated).
 *
 * A project resolves by its website slug (`artblocks.io/collection/<slug>`),
 * including Engine and Studio projects, all on Ethereum mainnet (`chain_id` 1).
 * Its tokens are listed from `tokens_metadata`, whose `live_view_url` is the
 * generator URL the indexer emitted as the item source, so no per-token
 * tokenURI fetch is needed.
 */

import type { MintSpec } from '@/lib/mintSpec'
import { checksumEvmAddress } from './evm'
import { graphqlRequest, VendorAPIError } from './http'
import { finalizeTokens } from './tokens'
import {
  LOAD_ALL_CAP,
  VENDOR_ARTBLOCKS,
  type VendorLoadResult,
  type VendorRelease,
  type VendorToken,
} from './types'

export const ARTBLOCKS_GRAPHQL_URL = 'https://artblocks-mainnet.hasura.app/v1/graphql'
export const ARTBLOCKS_CHAIN_ID = 1
/** Rows per request. Hasura returned 3000 rows in one call in testing; 500 keeps responses small. */
export const ARTBLOCKS_TOKENS_PAGE_SIZE = 500

export interface ArtBlocksProject {
  /** Composite "<contract>-<projectId>"; also the `project_id` filter value on tokens_metadata. */
  id: string
  project_id: string
  contract_address: string
  name: string | null
  artist_name: string | null
  invocations: number | null
  max_invocations: number | null
}

export interface ArtBlocksTokenRow {
  token_id: string
  invocation: number
  live_view_url: string | null
  preview_asset_url: string | null
}

const RESOLVE_PROJECT_QUERY = `
query ResolveProject($slug: String!, $chainId: Int!) {
  projects_metadata(where: {slug: {_eq: $slug}, chain_id: {_eq: $chainId}}, limit: 1) {
    id project_id contract_address name artist_name invocations max_invocations
  }
}`

const PROJECT_TOKENS_QUERY = `
query ProjectTokens($projectId: String!, $limit: Int!, $offset: Int!) {
  tokens_metadata(
    where: {project_id: {_eq: $projectId}}
    order_by: {invocation: asc}
    limit: $limit
    offset: $offset
  ) {
    token_id invocation live_view_url preview_asset_url
  }
}`

const PROJECT_TOKENS_BY_INVOCATION_QUERY = `
query ProjectTokensByInvocation($projectId: String!, $invocations: [Int!]!, $limit: Int!) {
  tokens_metadata(
    where: {project_id: {_eq: $projectId}, invocation: {_in: $invocations}}
    order_by: {invocation: asc}
    limit: $limit
  ) {
    token_id invocation live_view_url preview_asset_url
  }
}`

export async function resolveArtBlocksProject(slug: string): Promise<ArtBlocksProject> {
  const data = await graphqlRequest<{ projects_metadata: ArtBlocksProject[] }>(
    VENDOR_ARTBLOCKS,
    ARTBLOCKS_GRAPHQL_URL,
    RESOLVE_PROJECT_QUERY,
    { slug, chainId: ARTBLOCKS_CHAIN_ID }
  )
  const project = data.projects_metadata?.[0]
  if (!project) {
    throw new VendorAPIError(
      `No Art Blocks project with slug "${slug}" (slugs come from artblocks.io/collection/<slug>).`,
      VENDOR_ARTBLOCKS,
      'not_found'
    )
  }
  return project
}

/**
 * Map one token row. `token_id` is taken verbatim rather than recomputed as
 * projectId * 1e6 + invocation: the API value is authoritative and the formula
 * is an implementation detail of the contracts. The title keeps Art Blocks'
 * own 0-based numbering ("Fidenza #0"), which is also what the indexer emitted.
 * Returns null when the contract address is not a valid EVM address.
 */
export function artBlocksTokenToToken(
  project: ArtBlocksProject,
  row: ArtBlocksTokenRow
): VendorToken | null {
  const contractAddress = checksumEvmAddress(project.contract_address)
  if (!contractAddress) return null
  const source = row.live_view_url?.trim() || row.preview_asset_url?.trim() || null
  const projectName = project.name?.trim()
  return {
    vendor: VENDOR_ARTBLOCKS,
    mintNumber: row.invocation + 1,
    chain: 'evm',
    standard: 'erc721',
    contractAddress,
    tokenId: row.token_id,
    title: projectName ? `${projectName} #${row.invocation}` : null,
    source,
  }
}

async function fetchTokenRows(
  projectId: string,
  variables: Record<string, unknown>,
  query: string
): Promise<ArtBlocksTokenRow[]> {
  const data = await graphqlRequest<{ tokens_metadata: ArtBlocksTokenRow[] }>(
    VENDOR_ARTBLOCKS,
    ARTBLOCKS_GRAPHQL_URL,
    query,
    { projectId, ...variables }
  )
  return data.tokens_metadata ?? []
}

export async function loadArtBlocksRelease(
  slug: string,
  mintSpec: MintSpec | null
): Promise<VendorLoadResult> {
  const project = await resolveArtBlocksProject(slug)
  const release: VendorRelease = {
    vendor: VENDOR_ARTBLOCKS,
    slug,
    name: project.name?.trim() || null,
    totalMints: project.invocations ?? null,
  }

  const tokens: VendorToken[] = []
  let wasCapped = false

  if (mintSpec) {
    // Mint numbers are 1-based, invocations 0-based. Batches are sequential so a
    // 1000-entry spec is at most two requests and stays under the rate limit.
    for (let i = 0; i < mintSpec.length; i += ARTBLOCKS_TOKENS_PAGE_SIZE) {
      const invocations = mintSpec.slice(i, i + ARTBLOCKS_TOKENS_PAGE_SIZE).map((n) => n - 1)
      const rows = await fetchTokenRows(
        project.id,
        { invocations, limit: invocations.length },
        PROJECT_TOKENS_BY_INVOCATION_QUERY
      )
      for (const row of rows) {
        const token = artBlocksTokenToToken(project, row)
        if (token) tokens.push(token)
      }
    }
  } else {
    let offset = 0
    let fetched = 0
    let exhausted = false
    while (fetched < LOAD_ALL_CAP) {
      const limit = Math.min(ARTBLOCKS_TOKENS_PAGE_SIZE, LOAD_ALL_CAP - fetched)
      const rows = await fetchTokenRows(project.id, { limit, offset }, PROJECT_TOKENS_QUERY)
      fetched += rows.length
      for (const row of rows) {
        const token = artBlocksTokenToToken(project, row)
        if (token) tokens.push(token)
      }
      if (rows.length < limit) {
        exhausted = true
        break
      }
      offset += rows.length
    }
    const total = release.totalMints
    wasCapped = !exhausted && (total == null || total > fetched)
  }

  return { release, tokens: finalizeTokens(tokens), wasCapped, uncheckedMints: [] }
}
