/**
 * DP-1 core vs extensions (playlists + channels registries in dp-1/extensions/registry.json).
 * Aligns client behavior with dp1-feed-v2 when extensions are disabled: core playlist validation only;
 * channel APIs return extensions_disabled.
 */

import type { Playlist, PlaylistItem } from '@/types/dp1'

/** Env override: unset = follow feed metadata; true/false = force UI and publish shape. */
export function parseEnvExtensionsOverride(): boolean | undefined {
  const v = import.meta.env.VITE_DP1_EXTENSIONS_ENABLED
  if (v === undefined || v === '') return undefined
  const s = String(v).toLowerCase().trim()
  if (s === 'true' || s === '1' || s === 'yes') return true
  if (s === 'false' || s === '0' || s === 'no') return false
  return undefined
}

export function stripItemExtensionFields(item: PlaylistItem): PlaylistItem {
  const { note: _omit, ...rest } = item
  return rest
}

/** Drop playlists-extension fields so the payload matches core-only feed validation. */
export function stripPlaylistExtensionFields(p: Playlist): Playlist {
  const items = p.items.map(stripItemExtensionFields)
  const {
    curators: _c,
    summary: _s,
    coverImage: _ci,
    dynamicQuery: _dq,
    note: _n,
    ...rest
  } = p
  return { ...rest, items }
}
