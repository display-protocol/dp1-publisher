/**
 * Feed Server API Client
 * Base URL: https://feed.feralfile.com
 */

import type { Playlist, Channel } from '@/types/dp1'

const FEED_BASE_URL = import.meta.env.VITE_FEED_BASE_URL || 'https://feed.feralfile.com'

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
 * GET /api/v1/playlists/{id}
 * Fetch a playlist by UUID or slug
 */
export async function getPlaylist(idOrSlug: string): Promise<Playlist> {
  const response = await fetch(`${FEED_BASE_URL}/api/v1/playlists/${idOrSlug}`)

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
