/**
 * Merge helpers aligned with dp1-feed-v2 executor partial PATCH semantics
 * (see internal/executor/executor.go UpdatePlaylist / UpdateChannel).
 */

import type { Channel, Entity, Playlist, PlaylistItem } from '@/types/dp1'

export function mergePlaylistForPatch(
  existing: Playlist,
  patch: {
    dpVersion?: string
    title?: string
    slug?: string
    items?: PlaylistItem[]
    curators?: Entity[]
    summary?: string
    coverImage?: string
    defaults?: Playlist['defaults']
    dynamicQuery?: Record<string, unknown>
  }
): Playlist {
  return {
    ...existing,
    dpVersion: patch.dpVersion ?? existing.dpVersion,
    title: patch.title ?? existing.title,
    slug: patch.slug ?? existing.slug,
    items: patch.items ?? existing.items,
    curators: patch.curators ?? existing.curators,
    summary: patch.summary !== undefined ? patch.summary : existing.summary,
    coverImage: patch.coverImage !== undefined ? patch.coverImage : existing.coverImage,
    defaults: patch.defaults !== undefined ? patch.defaults : existing.defaults,
    dynamicQuery:
      patch.dynamicQuery !== undefined ? patch.dynamicQuery : existing.dynamicQuery,
  }
}

export function mergeChannelForPatch(
  existing: Channel,
  patch: {
    title?: string
    slug?: string
    version?: string
    playlists?: string[]
    curators?: Entity[]
    publisher?: Entity
    summary?: string
    coverImage?: string
  }
): Channel {
  return {
    ...existing,
    title: patch.title ?? existing.title,
    slug: patch.slug ?? existing.slug,
    version: patch.version ?? existing.version,
    playlists: patch.playlists ?? existing.playlists,
    curators: patch.curators !== undefined ? patch.curators : existing.curators,
    publisher: patch.publisher !== undefined ? patch.publisher : existing.publisher,
    summary: patch.summary !== undefined ? patch.summary : existing.summary,
    coverImage: patch.coverImage !== undefined ? patch.coverImage : existing.coverImage,
  }
}
