/**
 * Shared validation for `playlists[]` URI lists on channel and playlist-group
 * documents. Both resources carry the same feed playlist references; rules
 * must stay identical across Form-tab, JSON-tab, and preparePublish paths.
 */

import { validatePlaylistURI } from '@/lib/api'

export interface PlaylistUriListError {
  field: string
  message: string
}

/**
 * Validate a playlists array: non-empty, each entry a non-empty string passing
 * `validatePlaylistURI` (scheme, private-IP, debug-mode policy).
 */
export function validatePlaylistUriList(playlists: unknown): PlaylistUriListError[] {
  const errors: PlaylistUriListError[] = []

  if (!Array.isArray(playlists) || playlists.length === 0) {
    errors.push({ field: 'playlists', message: 'At least one playlist URI is required' })
    return errors
  }

  playlists.forEach((p, i) => {
    if (typeof p !== 'string') {
      errors.push({
        field: `playlists[${i}]`,
        message: `playlists[${i}] must be a string URI`,
      })
    } else if (p.trim().length === 0) {
      errors.push({
        field: `playlists[${i}]`,
        message: `playlists[${i}] must be a non-empty string`,
      })
    } else {
      const validation = validatePlaylistURI(p.trim())
      if (!validation.valid) {
        errors.push({
          field: `playlists[${i}]`,
          message: `playlists[${i}]: ${validation.reason || 'Invalid URI'}`,
        })
      }
    }
  })

  return errors
}
