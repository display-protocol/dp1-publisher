/**
 * Transport helpers shared by the vendor clients. HTTP only — no signing, no
 * wallet, no writes. Every failure surfaces as a VendorAPIError whose message is
 * meant for the curator (it is rendered as-is in the series panel).
 */

import { VENDOR_LABELS, type Vendor } from './types'

export type VendorErrorCode =
  | 'http'
  | 'graphql'
  | 'not_found'
  | 'unsupported'
  | 'network'
  | 'malformed'

export class VendorAPIError extends Error {
  constructor(
    message: string,
    public vendor: Vendor,
    public code: VendorErrorCode,
    public status?: number
  ) {
    super(message)
    this.name = 'VendorAPIError'
  }
}

function httpFailure(vendor: Vendor, status: number): VendorAPIError {
  const label = VENDOR_LABELS[vendor]
  const hint = status === 429 ? ' — rate limited, retry in a moment' : ''
  return new VendorAPIError(`${label} request failed (${status})${hint}.`, vendor, 'http', status)
}

/**
 * Per-request timeout. While a load runs the panel disables its inputs, so a
 * stalled vendor request must end in an error rather than leave the curator stuck.
 */
export const VENDOR_REQUEST_TIMEOUT_MS = 20_000

function timeoutFailure(vendor: Vendor): VendorAPIError {
  return new VendorAPIError(
    `${VENDOR_LABELS[vendor]} did not respond in time. Try again.`,
    vendor,
    'network'
  )
}

function networkFailure(vendor: Vendor): VendorAPIError {
  const label = VENDOR_LABELS[vendor]
  // Feral File is the only vendor that refuses cross-origin browsers (its CORS
  // allow-list covers publisher.feralfile.com but not localhost), so in local dev
  // a network error almost always means the Vite proxy is not in front of it.
  const hint =
    vendor === 'feralfile'
      ? ' In local dev, requests must go through the Vite proxy (see DEVELOPMENT.md).'
      : ''
  return new VendorAPIError(`Could not reach ${label}.${hint}`, vendor, 'network')
}

async function requestJson<T>(vendor: Vendor, url: string, init: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(VENDOR_REQUEST_TIMEOUT_MS) })
  } catch (e) {
    throw e instanceof DOMException && e.name === 'TimeoutError'
      ? timeoutFailure(vendor)
      : networkFailure(vendor)
  }
  if (!response.ok) {
    throw httpFailure(vendor, response.status)
  }
  try {
    return (await response.json()) as T
  } catch (e) {
    // The timeout signal also covers reading the body.
    if (e instanceof DOMException && e.name === 'TimeoutError') throw timeoutFailure(vendor)
    throw new VendorAPIError(
      `${VENDOR_LABELS[vendor]} returned a malformed response.`,
      vendor,
      'malformed'
    )
  }
}

/** GET a JSON document. */
export function fetchJson<T>(vendor: Vendor, url: string): Promise<T> {
  return requestJson<T>(vendor, url, { headers: { Accept: 'application/json' } })
}

interface GraphQLResponse<T> {
  data?: T
  errors?: Array<{ message: string }>
}

/**
 * POST a GraphQL query. Both Art Blocks and objkt are Hasura instances that answer
 * 200 with an `errors[]` body on validation failures, so `errors` is checked even
 * when the HTTP status is fine.
 */
export async function graphqlRequest<T>(
  vendor: Vendor,
  url: string,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const body = await requestJson<GraphQLResponse<T>>(vendor, url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  if (body.errors?.length) {
    throw new VendorAPIError(
      `${VENDOR_LABELS[vendor]} returned an error: ${body.errors.map((e) => e.message).join('; ')}`,
      vendor,
      'graphql'
    )
  }
  if (!body.data) {
    throw new VendorAPIError(`${VENDOR_LABELS[vendor]} returned no data.`, vendor, 'malformed')
  }
  return body.data
}
