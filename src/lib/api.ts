/**
 * Feed Server API Client
 * Base URL: https://feed.feralfile.com
 */

import type { Playlist, Channel, PlaylistGroup } from '@/types/dp1'

/** Base feed origin, no trailing slash (matches `VITE_FEED_BASE_URL` when set). */
export function getFeedBaseUrl(): string {
  return String(import.meta.env.VITE_FEED_BASE_URL || 'https://feed.feralfile.com').replace(
    /\/$/,
    ''
  )
}

const FEED_BASE_URL = getFeedBaseUrl()

/** GET /api/v1 — deployment metadata including `extensionsEnabled` (see https://github.com/display-protocol/dp1-feed-v2/blob/main/api/openapi.yaml). */
export interface FeedApiMetadata {
  name?: string
  version?: string
  description?: string
  extensionsEnabled: boolean
}

export async function getFeedApiMetadata(): Promise<FeedApiMetadata> {
  const base = getFeedBaseUrl()
  const response = await fetch(`${base}/api/v1`)
  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: 'unknown',
      message: response.statusText,
    }))
    throw new FeedAPIError(
      error.message || 'Failed to load feed metadata',
      response.status,
      error.error
    )
  }
  const data = (await response.json()) as { extensionsEnabled?: boolean }
  return {
    extensionsEnabled: data.extensionsEnabled !== false,
  }
}

/** GET resource URL for a playlist (API accepts UUID or slug). */
export function feedPlaylistResourceUrl(idOrSlug: string): string {
  return `${FEED_BASE_URL}/api/v1/playlists/${encodeURIComponent(idOrSlug.trim())}`
}

/** GET resource URL for a channel (API accepts UUID or slug). */
export function feedChannelResourceUrl(idOrSlug: string): string {
  return `${FEED_BASE_URL}/api/v1/channels/${encodeURIComponent(idOrSlug.trim())}`
}

/** GET resource URL for a playlist-group / exhibition (API accepts UUID or slug). */
export function feedPlaylistGroupResourceUrl(idOrSlug: string): string {
  return `${FEED_BASE_URL}/api/v1/playlist-groups/${encodeURIComponent(idOrSlug.trim())}`
}

/**
 * Local dev only: set `VITE_DEBUG_MODE=true` in `.env` while running the Vite dev server.
 * Disabled in production builds (`import.meta.env.DEV` is false).
 */
export function isDebugMode(): boolean {
  return (
    import.meta.env.DEV === true &&
    String(import.meta.env.VITE_DEBUG_MODE ?? '').toLowerCase() === 'true'
  )
}

export class FeedAPIError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message)
    this.name = 'FeedAPIError'
  }
}

/**
 * Translate raw feed/HTTP errors into messages a non-developer can act on.
 * Use for publish/update toasts so the surface never shows raw Postgres or
 * protocol-level signature complaints.
 */
export function friendlyPublishError(
  err: unknown,
  kind: 'playlist' | 'playlist-group' | 'channel',
  intent: 'create' | 'update'
): string {
  const noun =
    kind === 'playlist'
      ? 'playlist'
      : kind === 'channel'
        ? 'channel'
        : 'playlist group'

  if (err instanceof FeedAPIError) {
    const raw = err.message || ''
    const lower = raw.toLowerCase()

    // Wrong wallet trying to overwrite someone else's document.
    if (
      err.status === 401 ||
      err.status === 403 ||
      lower.includes('signature') ||
      lower.includes('unauthorized') ||
      lower.includes('forbidden')
    ) {
      return intent === 'update'
        ? `This ${noun} was published by a different wallet. Connect that wallet to update it, or publish under a new id.`
        : `Signing failed: the feed rejected your signature. Make sure the connected wallet matches the curator declared in the document.`
    }

    // Duplicate primary/unique key from Postgres (safety net — the
    // pre-flight check in the publish handler usually intercepts this).
    if (
      lower.includes('duplicate key') ||
      lower.includes('unique constraint') ||
      lower.includes('sqlstate 23505')
    ) {
      return `A ${noun} with this id or slug already exists on the feed. Upload again to overwrite it, or change the slug.`
    }

    if (err.status === 404 && intent === 'update') {
      return `The ${noun} you tried to update is no longer on the feed.`
    }

    // Generic feed message but stripped of leading "store: insert …" noise.
    return raw.replace(/^store:\s*\w+\s*\w+:\s*/i, '').trim() || `Feed rejected the ${noun}.`
  }

  if (err instanceof Error) {
    return err.message
  }
  return `Unknown error while ${intent === 'update' ? 'updating' : 'publishing'} the ${noun}.`
}

/**
 * POST /api/v1/playlists
 * Create a new playlist with signature-based authentication
 */
export async function publishPlaylist(playlist: Playlist): Promise<Playlist> {
  const response = await fetch(`${FEED_BASE_URL}/api/v1/playlists`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(playlist),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ 
      error: 'unknown', 
      message: response.statusText 
    }))
    throw new FeedAPIError(
      error.message || 'Failed to publish playlist',
      response.status,
      error.error
    )
  }

  return response.json()
}

/**
 * POST /api/v1/channels
 * Create a new channel with signature-based authentication
 */
export async function publishChannel(channel: Channel): Promise<Channel> {
  const response = await fetch(`${FEED_BASE_URL}/api/v1/channels`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(channel),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ 
      error: 'unknown', 
      message: response.statusText 
    }))
    throw new FeedAPIError(
      error.message || 'Failed to publish channel',
      response.status,
      error.error
    )
  }

  return response.json()
}

/**
 * POST /api/v1/playlist-groups — create exhibition; body matches PlaylistGroupCreateRequest (https://github.com/display-protocol/dp1-feed-v2).
 */
export async function publishPlaylistGroup(body: Record<string, unknown>): Promise<PlaylistGroup> {
  const response = await fetch(`${FEED_BASE_URL}/api/v1/playlist-groups`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: 'unknown',
      message: response.statusText,
    }))
    throw new FeedAPIError(
      error.message || 'Failed to publish playlist group',
      response.status,
      error.error
    )
  }

  return response.json()
}

/**
 * GET /api/v1/playlists/{id}
 * Fetch a playlist by UUID or slug
 */
export async function getPlaylist(idOrSlug: string): Promise<Playlist> {
  const response = await fetch(
    `${FEED_BASE_URL}/api/v1/playlists/${encodeURIComponent(idOrSlug)}`
  )

  if (!response.ok) {
    const error = await response.json().catch(() => ({ 
      error: 'not_found', 
      message: 'Playlist not found' 
    }))
    throw new FeedAPIError(
      error.message || 'Failed to fetch playlist',
      response.status,
      error.error
    )
  }

  return response.json()
}

export interface FeedListResponse<T> {
  items: T[]
  hasMore: boolean
  cursor?: string
}

/**
 * GET /api/v1/playlists — paginated list (sort by created_at)
 */
export async function listPlaylists(params: {
  limit?: number
  cursor?: string
  sort?: 'asc' | 'desc'
}): Promise<FeedListResponse<Playlist>> {
  const sp = new URLSearchParams()
  if (params.limit != null) sp.set('limit', String(params.limit))
  if (params.cursor) sp.set('cursor', params.cursor)
  if (params.sort) sp.set('sort', params.sort)
  const q = sp.toString()
  const response = await fetch(
    `${FEED_BASE_URL}/api/v1/playlists${q ? `?${q}` : ''}`
  )

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: 'unknown',
      message: response.statusText,
    }))
    throw new FeedAPIError(
      error.message || 'Failed to list playlists',
      response.status,
      error.error
    )
  }

  return response.json()
}

/**
 * GET /api/v1/playlist-groups/{id}
 */
export async function getPlaylistGroup(idOrSlug: string): Promise<PlaylistGroup> {
  const response = await fetch(
    `${FEED_BASE_URL}/api/v1/playlist-groups/${encodeURIComponent(idOrSlug)}`
  )

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: 'not_found',
      message: 'Playlist group not found',
    }))
    throw new FeedAPIError(
      error.message || 'Failed to fetch playlist group',
      response.status,
      error.error
    )
  }

  return response.json()
}

/**
 * GET /api/v1/playlist-groups — paginated list
 */
export async function listPlaylistGroups(params: {
  limit?: number
  cursor?: string
  sort?: 'asc' | 'desc'
}): Promise<FeedListResponse<PlaylistGroup>> {
  const sp = new URLSearchParams()
  if (params.limit != null) sp.set('limit', String(params.limit))
  if (params.cursor) sp.set('cursor', params.cursor)
  if (params.sort) sp.set('sort', params.sort)
  const q = sp.toString()
  const response = await fetch(
    `${FEED_BASE_URL}/api/v1/playlist-groups${q ? `?${q}` : ''}`
  )

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: 'unknown',
      message: response.statusText,
    }))
    throw new FeedAPIError(
      error.message || 'Failed to list playlist groups',
      response.status,
      error.error
    )
  }

  return response.json()
}

/**
 * GET /api/v1/channels/{id}
 */
export async function getChannel(idOrSlug: string): Promise<Channel> {
  const response = await fetch(
    `${FEED_BASE_URL}/api/v1/channels/${encodeURIComponent(idOrSlug)}`
  )

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: 'not_found',
      message: 'Channel not found',
    }))
    throw new FeedAPIError(
      error.message || 'Failed to fetch channel',
      response.status,
      error.error
    )
  }

  return response.json()
}

/**
 * GET /api/v1/channels — paginated list
 */
export async function listChannels(params: {
  limit?: number
  cursor?: string
  sort?: 'asc' | 'desc'
}): Promise<FeedListResponse<Channel>> {
  const sp = new URLSearchParams()
  if (params.limit != null) sp.set('limit', String(params.limit))
  if (params.cursor) sp.set('cursor', params.cursor)
  if (params.sort) sp.set('sort', params.sort)
  const q = sp.toString()
  const response = await fetch(
    `${FEED_BASE_URL}/api/v1/channels${q ? `?${q}` : ''}`
  )

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: 'unknown',
      message: response.statusText,
    }))
    throw new FeedAPIError(
      error.message || 'Failed to list channels',
      response.status,
      error.error
    )
  }

  return response.json()
}

/**
 * PATCH /api/v1/playlists/{id} — partial update with signature-based auth
 */
export async function patchPlaylist(
  idOrSlug: string,
  body: Record<string, unknown>
): Promise<Playlist> {
  const response = await fetch(
    `${FEED_BASE_URL}/api/v1/playlists/${encodeURIComponent(idOrSlug)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: 'unknown',
      message: response.statusText,
    }))
    throw new FeedAPIError(
      error.message || 'Failed to update playlist',
      response.status,
      error.error
    )
  }

  return response.json()
}

/**
 * PATCH /api/v1/playlist-groups/{id} — partial update with signature-based auth
 */
export async function patchPlaylistGroup(
  idOrSlug: string,
  body: Record<string, unknown>
): Promise<PlaylistGroup> {
  const response = await fetch(
    `${FEED_BASE_URL}/api/v1/playlist-groups/${encodeURIComponent(idOrSlug)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: 'unknown',
      message: response.statusText,
    }))
    throw new FeedAPIError(
      error.message || 'Failed to update playlist group',
      response.status,
      error.error
    )
  }

  return response.json()
}

/**
 * PATCH /api/v1/channels/{id} — partial update with signature-based auth
 */
export async function patchChannel(
  idOrSlug: string,
  body: Record<string, unknown>
): Promise<Channel> {
  const response = await fetch(
    `${FEED_BASE_URL}/api/v1/channels/${encodeURIComponent(idOrSlug)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: 'unknown',
      message: response.statusText,
    }))
    throw new FeedAPIError(
      error.message || 'Failed to update channel',
      response.status,
      error.error
    )
  }

  return response.json()
}

/**
 * Check if an IPv4 address (as 4 bytes) is in a private/loopback range (RFC1918, RFC3927, loopback).
 * Returns true if the address should be blocked.
 */
function isPrivateOrLoopbackIPv4(bytes: number[]): boolean {
  if (bytes.length !== 4) return false
  
  // 127.0.0.0/8 - loopback
  if (bytes[0] === 127) return true
  
  // 10.0.0.0/8 - private
  if (bytes[0] === 10) return true
  
  // 172.16.0.0/12 - private (172.16.0.0 through 172.31.255.255)
  if (bytes[0] === 172 && bytes[1] >= 16 && bytes[1] <= 31) return true
  
  // 192.168.0.0/16 - private
  if (bytes[0] === 192 && bytes[1] === 168) return true
  
  // 169.254.0.0/16 - link-local
  if (bytes[0] === 169 && bytes[1] === 254) return true
  
  // 0.0.0.0/8 - current network (should not route)
  if (bytes[0] === 0) return true
  
  return false
}

/**
 * Parse an IPv4 address string into bytes. Returns null if invalid.
 * Handles decimal notation only (not octal, hex, or other obfuscations).
 */
function parseIPv4(hostname: string): number[] | null {
  const parts = hostname.split('.')
  if (parts.length !== 4) return null
  
  const bytes: number[] = []
  for (const part of parts) {
    // Reject empty parts or non-numeric
    if (part === '' || !/^\d+$/.test(part)) return null
    
    const num = parseInt(part, 10)
    // Reject out of range or leading zeros (which could be octal interpretation)
    if (num > 255 || (part.length > 1 && part[0] === '0')) return null
    
    bytes.push(num)
  }
  
  return bytes
}

/**
 * Check if hostname is a private/loopback IPv6 address.
 * Returns true if the address should be blocked.
 * 
 * Note: This is a pattern-based check, not full RFC parsing. It catches common private/loopback forms.
 */
function isPrivateOrLoopbackIPv6(hostname: string): boolean {
  const lower = hostname.toLowerCase()
  
  // ::1 - loopback (short form)
  if (lower === '::1') return true
  
  // Loopback expanded forms
  if (lower === '0:0:0:0:0:0:0:1' || lower.includes('::0:1') || lower.includes('::ffff:127.')) return true
  
  // :: - unspecified address
  if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true
  
  // fe80::/10 - link-local
  if (lower.startsWith('fe80:') || lower.startsWith('fe8') || lower.startsWith('fe9') || 
      lower.startsWith('fea') || lower.startsWith('feb')) return true
  
  // fc00::/7 - unique local addresses (fc00-fdff)
  if (lower.startsWith('fc0') || lower.startsWith('fc') || lower.startsWith('fd')) return true
  
  // Common compressed forms of loopback
  if (lower.match(/^0*:0*:0*:0*:0*:0*:0*:1$/)) return true
  
  // IPv4-mapped and IPv4-compatible IPv6 addresses
  // - IPv4-mapped: ::ffff:x.x.x.x (or ::ffff:xxxx:xxxx after normalization)
  // - IPv4-compatible (deprecated): ::x.x.x.x (normalizes to ::xxxx:xxxx)
  // Browser URL parser converts both to hex. Examples:
  //   [::ffff:192.168.1.1] → [::ffff:c0a8:101]
  //   [::192.168.1.1] → [::c0a8:101]
  
  // IMPORTANT: Only match addresses that START with :: (not mid-address compressions like 2001:db8::c0a8:101)
  // IPv4-compatible and IPv4-mapped addresses have all zeros before the IPv4 portion
  const ipv4InIPv6Match = lower.match(/^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (ipv4InIPv6Match) {
    // Convert hex segments back to IPv4 bytes
    const high = parseInt(ipv4InIPv6Match[1], 16)
    const low = parseInt(ipv4InIPv6Match[2], 16)
    const ipv4Bytes = [
      (high >> 8) & 0xff,
      high & 0xff,
      (low >> 8) & 0xff,
      low & 0xff
    ]
    if (isPrivateOrLoopbackIPv4(ipv4Bytes)) {
      return true
    }
  }
  
  return false
}

/**
 * Validate playlist URI format and security.
 * Blocks http:// (prod only), localhost, loopback, and RFC1918 private IPs (IPv4 + common IPv6 patterns).
 */
export function validatePlaylistURI(uri: string): { valid: boolean; reason?: string } {
  if (isDebugMode()) {
    try {
      const url = new URL(uri)
      if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'ipfs:') {
        return { valid: true }
      }
      return {
        valid: false,
        reason: 'Only http://, https://, and ipfs:// URIs are allowed (debug mode)',
      }
    } catch {
      return { valid: false, reason: 'Invalid URI format' }
    }
  }

  try {
    const url = new URL(uri)

    // Only allow https:// and ipfs://
    if (url.protocol !== 'https:' && url.protocol !== 'ipfs:') {
      return { valid: false, reason: 'Only https:// and ipfs:// URIs are allowed' }
    }

    // For ipfs://, no hostname to check
    if (url.protocol === 'ipfs:') {
      return { valid: true }
    }

    // Block localhost by name
    let hostname = url.hostname.toLowerCase()
    if (hostname === 'localhost') {
      return { valid: false, reason: 'Private/local URIs are not allowed' }
    }

    // IPv6 literals may have brackets in some environments; strip them
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
      hostname = hostname.slice(1, -1)
    }

    // Check if hostname is an IPv6 literal (contains colons)
    if (hostname.includes(':')) {
      if (isPrivateOrLoopbackIPv6(hostname)) {
        return { valid: false, reason: 'Private/local URIs are not allowed' }
      }
      return { valid: true }
    }

    // Check if hostname is an IPv4 address
    const ipv4Bytes = parseIPv4(hostname)
    if (ipv4Bytes) {
      if (isPrivateOrLoopbackIPv4(ipv4Bytes)) {
        return { valid: false, reason: 'Private/local URIs are not allowed' }
      }
      return { valid: true }
    }

    // If it looks like an IPv4 address (4 dot-separated parts) but failed to parse,
    // reject it as potentially malformed or obfuscated
    const parts = hostname.split('.')
    if (parts.length === 4 && parts.every(p => /^\d+$/.test(p))) {
      return { valid: false, reason: 'Malformed or obfuscated IP address' }
    }

    // Hostname is a domain name; allow it (browser DNS will resolve, but we can't block all possible resolutions here)
    return { valid: true }
  } catch {
    return { valid: false, reason: 'Invalid URI format' }
  }
}
