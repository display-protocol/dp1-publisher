/**
 * Merge helpers that build the full replacement document from the stored one plus the user's edits.
 * The feed no longer merges anything server-side (PATCH is gone), so the merge happens here and the
 * result is sent whole.
 * (see internal/executor/executor.go UpdatePlaylist / UpdateChannel on main).
 */

import type {
  Channel,
  DynamicQuery,
  Entity,
  Note,
  Playlist,
  PlaylistItem,
} from '@/types/dp1'

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
    dynamicQuery?: DynamicQuery
    note?: Note
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
    note: patch.note !== undefined ? patch.note : existing.note,
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
