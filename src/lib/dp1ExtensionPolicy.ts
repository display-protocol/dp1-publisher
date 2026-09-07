/**
 * DP-1 core vs extensions (playlists + channels registries in dp-1/extensions/registry.json).
 * Aligns client behavior with https://github.com/display-protocol/dp1-feed-v2 when extensions are disabled: core playlist validation only;
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
  // `note`, `displayAt` (§3.5.2 scheduling), and `inlineManifest` (§3.6 inline
  // Ref Manifest) are all playlists-extension fields. A core-only feed accepts
  // unknown item keys without validating them, so stripping here is what keeps
  // a core-mode publish from signing an unvalidated schedule — or a whole
  // unvalidated manifest — into the document.
  const {
    note: _omit,
    displayAt: _omitDisplayAt,
    inlineManifest: _omitInlineManifest,
    ...rest
  } = item
  return rest
}

/**
 * Names the playlists-extension fields a stored document actually carries.
 *
 * Only meaningful on a replace. A create in core mode has nothing to lose: there is no stored document,
 * so stripping shapes a fresh payload and that is the whole intent. A replace is different — it sends the
 * *complete* document, so a field stripped here is a field erased on the feed. That was invisible while
 * updates were PATCH, because the feed merged a partial body and anything omitted survived.
 *
 * `curators` is the sharpest case: it is a playlists-extension field and also the feed's owner set, which
 * a replace may not change. Stripping it produces a document with no owner, which the feed rejects as an
 * owner change — and the wallet is not re-added, since that step only runs when extensions are on.
 */
export function playlistExtensionFieldsPresent(p: Playlist): string[] {
  const present: string[] = []
  if (Array.isArray(p.curators) && p.curators.length > 0) present.push('curators')
  if (typeof p.summary === 'string' && p.summary.trim() !== '') present.push('summary')
  if (typeof p.coverImage === 'string' && p.coverImage.trim() !== '') present.push('coverImage')
  if (p.dynamicQuery !== undefined) present.push('dynamicQuery')
  if (p.note !== undefined) present.push('note')
  const itemFields = new Set<string>()
  for (const item of p.items ?? []) {
    if (item.note !== undefined) itemFields.add('items[].note')
    if (item.displayAt !== undefined) itemFields.add('items[].displayAt')
    if (item.inlineManifest !== undefined) itemFields.add('items[].inlineManifest')
  }
  return [...present, ...[...itemFields].sort()]
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
