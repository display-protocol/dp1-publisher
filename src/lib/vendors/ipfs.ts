/**
 * IPFS URI → https gateway URL.
 *
 * objkt reports token media as `ipfs://…`. DP-1 allows an ipfs: source, but
 * everything this app has ever published for series items is https (the indexer
 * resolved IPFS through a gateway), and the publisher's URI gate and most players
 * expect https. The gateway is configurable because availability of a given CID
 * is the gateway's concern, not the feed's: the feed never fetches `source`.
 */

/**
 * A public fetching gateway (one of the two ff-indexer-v2 is configured with), not
 * ipfs.feralfile.com: that gateway runs with NoFetch and 404s any CID Feral File
 * has not pinned, which is all objkt media.
 */
export const DEFAULT_IPFS_GATEWAY_BASE_URL = 'https://ipfs.filebase.io/ipfs'

/** Gateway base, no trailing slash. `VITE_IPFS_GATEWAY_BASE_URL` overrides the default. */
export function getIpfsGatewayBaseUrl(): string {
  return String(import.meta.env.VITE_IPFS_GATEWAY_BASE_URL || DEFAULT_IPFS_GATEWAY_BASE_URL).replace(
    /\/+$/,
    ''
  )
}

// `ipfs://<cid>[/path][?query]`; the legacy `ipfs://ipfs/<cid>` double prefix is
// also accepted because some Tezos metadata still carries it.
const IPFS_URI = /^ipfs:\/\/(?:ipfs\/)?(.+)$/i

/**
 * Resolve an `ipfs://` URI to the gateway; any other value (https, onchfs, data…)
 * is returned unchanged so callers can pass vendor fields through blindly.
 */
export function resolveIpfsUri(uri: string): string {
  const trimmed = uri.trim()
  const match = IPFS_URI.exec(trimmed)
  if (!match) return trimmed
  return `${getIpfsGatewayBaseUrl()}/${match[1].replace(/^\/+/, '')}`
}
