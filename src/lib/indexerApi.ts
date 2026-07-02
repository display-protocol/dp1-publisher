/**
 * ff-indexer-v2 GraphQL client (browser).
 * Base URL mirrors feed client pattern: VITE_INDEXER_BASE_URL + /graphql.
 */

export const INDEXER_VENDOR_FERALFILE = 'feralfile'
export const INDEXER_VENDOR_ARTBLOCKS = 'artblocks'

/** GraphQL Uint8 max for tokens(release_id) list requests. */
export const MAX_RELEASE_TOKENS = 255

export interface IndexerReleaseSummary {
  id: number
  vendor: string
  vendor_release_id: string
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
  display: IndexerTokenDisplay | null
  metadata: { name: string | null } | null
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

/** Art Blocks vendor_release_id: chain 1 (mainnet) + lowercased contract + project ID (matches indexer storage). */
export function buildArtBlocksVendorReleaseId(contract: string, projectId: string): string {
  return `1-${contract.trim().toLowerCase()}-${projectId.trim()}`
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

const RESOLVE_RELEASE_QUERY = `
  query ResolveRelease($vendor: String!, $vendorReleaseId: String!) {
    releases(vendor: $vendor, vendor_release_id: $vendorReleaseId, limit: 1) {
      items {
        id
        vendor
        vendor_release_id
        name
        total_mints
      }
    }
  }
`

const RELEASE_TOKENS_QUERY = `
  query ReleaseTokens($releaseId: Uint64!, $limit: Uint8!) {
    tokens(
      release_id: $releaseId
      sort_by: mint_number
      sort_order: asc
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
        display {
          animation_url
          image_url
        }
        metadata {
          name
        }
      }
    }
  }
`

/** Resolve a release by vendor key (FF series UUID or AB project id). */
export async function resolveRelease(
  vendor: string,
  vendorReleaseId: string
): Promise<IndexerReleaseSummary | null> {
  const data = await graphqlRequest<{
    releases: { items: IndexerReleaseSummary[] }
  }>(RESOLVE_RELEASE_QUERY, {
    vendor,
    vendorReleaseId: vendorReleaseId.trim(),
  })

  return data.releases.items[0] ?? null
}

/** Mint-ordered tokens for a release (single request, capped at MAX_RELEASE_TOKENS). */
export async function fetchReleaseTokens(releaseId: number): Promise<IndexerToken[]> {
  const data = await graphqlRequest<{
    tokens: { items: IndexerToken[] }
  }>(RELEASE_TOKENS_QUERY, {
    releaseId,
    limit: MAX_RELEASE_TOKENS,
  })

  return data.tokens.items
}
