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
 * Check if a playlist URI is reachable (HEAD request)
 * Returns true if status is 200, false otherwise
 */
export async function checkPlaylistReachable(uri: string): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000) // 5s timeout

    const response = await fetch(uri, {
      method: 'HEAD',
      signal: controller.signal,
    })

    clearTimeout(timeoutId)
    return response.ok
  } catch {
    return false
  }
}

/**
 * Validate playlist URI format and security
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

    // Block localhost and private IPs
    const hostname = url.hostname.toLowerCase()
    if (
      hostname === 'localhost' ||
      hostname.startsWith('127.') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('172.16.') ||
      hostname.startsWith('172.17.') ||
      hostname.startsWith('172.18.') ||
      hostname.startsWith('172.19.') ||
      hostname.startsWith('172.2') ||
      hostname.startsWith('172.30.') ||
      hostname.startsWith('172.31.')
    ) {
      return { valid: false, reason: 'Private/local URIs are not allowed' }
    }

    return { valid: true }
  } catch {
    return { valid: false, reason: 'Invalid URI format' }
  }
}
