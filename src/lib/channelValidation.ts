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

export function validateChannelFields(
  channel: Partial<Channel>
): ChannelValidationError[] {
  const errors: ChannelValidationError[] = []

  // Title
  if (!channel.title || channel.title.trim().length === 0) {
    errors.push({ field: 'title', message: 'Title is required' })
  } else if (channel.title.length > 200) {
    errors.push({ field: 'title', message: 'Title must be 200 characters or less' })
  }

  // Slug (lowercase, hyphens only)
  if (channel.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(channel.slug)) {
    errors.push({
      field: 'slug',
      message: 'Slug must contain only lowercase letters, numbers, and hyphens',
    })
  }

  // Summary
  if (channel.summary && channel.summary.length > 2000) {
    errors.push({
      field: 'summary',
      message: 'Summary must be 2000 characters or less',
    })
  }

  // Cover image URI
  if (channel.coverImage && !/^(https?|ipfs|ar):\/\/.+/.test(channel.coverImage)) {
    errors.push({
      field: 'coverImage',
      message: 'Cover image must be a valid URI (https://, ipfs://, or ar://)',
    })
  }

  // Playlists
  if (!channel.playlists || channel.playlists.length === 0) {
    errors.push({ field: 'playlists', message: 'At least one playlist URI is required' })
  }

  // Publisher
  if (channel.publisher) {
    if (!channel.publisher.name || channel.publisher.name.trim().length === 0) {
      errors.push({ field: 'publisher.name', message: 'Publisher name is required' })
    }
    if (!channel.publisher.key || !/^did:[a-z]+:.+$/.test(channel.publisher.key)) {
      errors.push({ field: 'publisher.key', message: 'Publisher key must be in DID format' })
    }
    if (channel.publisher.url && !/^https?:\/\/.+/.test(channel.publisher.url)) {
      errors.push({
        field: 'publisher.url',
        message: 'Publisher URL must be a valid HTTP(S) URL',
      })
    }
  }

  // Curators
  if (channel.curators) {
    channel.curators.forEach((curator, index) => {
      if (!curator.name || curator.name.trim().length === 0) {
        errors.push({
          field: `curators[${index}].name`,
          message: `Curator ${index + 1} name is required`,
        })
      }
      if (!curator.key || !/^did:[a-z]+:.+$/.test(curator.key)) {
        errors.push({
          field: `curators[${index}].key`,
          message: `Curator ${index + 1} key must be in DID format`,
        })
      }
      if (curator.url && !/^https?:\/\/.+/.test(curator.url)) {
        errors.push({
          field: `curators[${index}].url`,
          message: `Curator ${index + 1} URL must be a valid HTTP(S) URL`,
        })
      }
    })
  }

  return errors
}
