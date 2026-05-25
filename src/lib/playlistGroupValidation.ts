/**
 * Field-level validation for DP-1 playlist groups — shared by Form-tab and
 * JSON-tab publish paths after signer-identity repair in `preparePublish.ts`.
 */

import type { PlaylistGroup } from '@/types/dp1'

export interface PlaylistGroupValidationError {
  field: string
  message: string
}

/**
 * Validates a playlist-group-shaped value defensively. Signer parity with the
 * connected wallet is enforced upstream by `ensurePlaylistGroupWalletCurator`;
 * this gate checks structural rules only.
 */
export function validatePlaylistGroupFields(
  group: Partial<PlaylistGroup>
): PlaylistGroupValidationError[] {
  const errors: PlaylistGroupValidationError[] = []

  if (typeof group.title !== 'string' || group.title.trim().length === 0) {
    errors.push({ field: 'title', message: 'Title is required' })
  } else if (group.title.length > 200) {
    errors.push({ field: 'title', message: 'Title must be 200 characters or less' })
  }

  if (group.slug !== undefined && group.slug !== null && group.slug !== '') {
    if (typeof group.slug !== 'string') {
      errors.push({ field: 'slug', message: 'Slug must be a string' })
    } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(group.slug)) {
      errors.push({
        field: 'slug',
        message: 'Slug must be lowercase letters, numbers, and hyphens only',
      })
    }
  }

  if (!Array.isArray(group.playlists) || group.playlists.length === 0) {
    errors.push({ field: 'playlists', message: 'At least one playlist URI is required' })
  }

  const curator = typeof group.curator === 'string' ? group.curator.trim() : ''
  if (!curator) {
    errors.push({
      field: 'curator',
      message: 'Curator DID is required for signature verification on the feed',
    })
  } else if (!/^did:[a-z]+:.+$/.test(curator)) {
    errors.push({ field: 'curator', message: 'Curator must be a W3C DID (e.g. did:pkh:...)' })
  }

  if (typeof group.summary === 'string' && group.summary.length > 5000) {
    errors.push({ field: 'summary', message: 'Summary is too long' })
  }

  if (
    typeof group.coverImage === 'string' &&
    group.coverImage.trim() !== '' &&
    !/^(https?|ipfs|ar):\/\/.+/i.test(group.coverImage.trim())
  ) {
    errors.push({
      field: 'coverImage',
      message: 'Cover image must be a valid URI (https://, ipfs://, or ar://)',
    })
  }

  return errors
}
