/**
 * Field-level validation for DP-1 channels — used by both the Form-tab and
 * (now) the JSON-tab create paths in ChannelForm. Lifted out of the component
 * so both paths share one source of truth and the rules are independently
 * testable.
 */

import type { Channel } from '@/types/dp1'

export interface ChannelValidationError {
  field: string
  message: string
}

/**
 * Validates a channel-shaped value, defensively. Callers include the JSON-tab
 * paths where `parseChannelJson` only checks `title` and `playlists` before
 * casting to `Channel` — so `publisher` / `curators` can be any shape coming
 * through the JSON boundary (object instead of array, null entries,
 * non-string fields, etc.). The validator never throws on shape; instead,
 * shape errors are surfaced as validation messages alongside field errors.
 */
export function validateChannelFields(
  channel: Partial<Channel>
): ChannelValidationError[] {
  const errors: ChannelValidationError[] = []

  // Title
  if (typeof channel.title !== 'string' || channel.title.trim().length === 0) {
    errors.push({ field: 'title', message: 'Title is required' })
  } else if (channel.title.length > 200) {
    errors.push({ field: 'title', message: 'Title must be 200 characters or less' })
  }

  // Slug (lowercase, hyphens only). Non-string slug from imported JSON would
  // otherwise pass this gate silently and crash later inside the unsigned-
  // payload construction (`generateChannelSlug` / `.trim()` on a non-string).
  if (channel.slug !== undefined && channel.slug !== null && channel.slug !== '') {
    if (typeof channel.slug !== 'string') {
      errors.push({ field: 'slug', message: 'Slug must be a string' })
    } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(channel.slug)) {
      errors.push({
        field: 'slug',
        message: 'Slug must contain only lowercase letters, numbers, and hyphens',
      })
    }
  }

  // Summary
  if (channel.summary !== undefined && channel.summary !== null && channel.summary !== '') {
    if (typeof channel.summary !== 'string') {
      errors.push({ field: 'summary', message: 'Summary must be a string' })
    } else if (channel.summary.length > 2000) {
      errors.push({
        field: 'summary',
        message: 'Summary must be 2000 characters or less',
      })
    }
  }

  // Cover image URI
  if (
    channel.coverImage !== undefined &&
    channel.coverImage !== null &&
    channel.coverImage !== ''
  ) {
    if (typeof channel.coverImage !== 'string') {
      errors.push({ field: 'coverImage', message: 'Cover image must be a string' })
    } else if (!/^(https?|ipfs|ar):\/\/.+/.test(channel.coverImage)) {
      errors.push({
        field: 'coverImage',
        message: 'Cover image must be a valid URI (https://, ipfs://, or ar://)',
      })
    }
  }

  // Playlists. Feed's typed `[]string` reconstruction drops non-string
  // entries during json.Marshal — so a non-string in the imported array
  // would survive in the client's signed bytes but disappear feed-side,
  // producing a signature mismatch. Validate the shape before signing.
  if (!Array.isArray(channel.playlists) || channel.playlists.length === 0) {
    errors.push({ field: 'playlists', message: 'At least one playlist URI is required' })
  } else {
    channel.playlists.forEach((p, i) => {
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
      }
    })
  }

  // Publisher
  if (channel.publisher !== undefined && channel.publisher !== null) {
    if (typeof channel.publisher !== 'object' || Array.isArray(channel.publisher)) {
      errors.push({ field: 'publisher', message: 'Publisher must be an object' })
    } else {
      const p = channel.publisher as { name?: unknown; key?: unknown; url?: unknown }
      if (typeof p.name !== 'string' || p.name.trim().length === 0) {
        errors.push({ field: 'publisher.name', message: 'Publisher name is required' })
      }
      if (typeof p.key !== 'string' || !/^did:[a-z]+:.+$/.test(p.key)) {
        errors.push({
          field: 'publisher.key',
          message: 'Publisher key must be in DID format',
        })
      }
      if (
        p.url !== undefined &&
        p.url !== '' &&
        (typeof p.url !== 'string' || !/^https?:\/\/.+/.test(p.url))
      ) {
        errors.push({
          field: 'publisher.url',
          message: 'Publisher URL must be a valid HTTP(S) URL',
        })
      }
    }
  }

  // Curators
  if (channel.curators !== undefined && channel.curators !== null) {
    if (!Array.isArray(channel.curators)) {
      errors.push({ field: 'curators', message: 'Curators must be an array' })
    } else {
      channel.curators.forEach((curator, index) => {
        if (!curator || typeof curator !== 'object' || Array.isArray(curator)) {
          errors.push({
            field: `curators[${index}]`,
            message: `Curator ${index + 1} must be an object`,
          })
          return
        }
        const c = curator as { name?: unknown; key?: unknown; url?: unknown }
        if (typeof c.name !== 'string' || c.name.trim().length === 0) {
          errors.push({
            field: `curators[${index}].name`,
            message: `Curator ${index + 1} name is required`,
          })
        }
        if (typeof c.key !== 'string' || !/^did:[a-z]+:.+$/.test(c.key)) {
          errors.push({
            field: `curators[${index}].key`,
            message: `Curator ${index + 1} key must be in DID format`,
          })
        }
        if (
          c.url !== undefined &&
          c.url !== '' &&
          (typeof c.url !== 'string' || !/^https?:\/\/.+/.test(c.url))
        ) {
          errors.push({
            field: `curators[${index}].url`,
            message: `Curator ${index + 1} URL must be a valid HTTP(S) URL`,
          })
        }
      })
    }
  }

  return errors
}
