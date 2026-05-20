/**
 * Per-item DP-1 display overrides.
 *
 * Every field in `item.display` is an override on top of `playlist.defaults.display`
 * — unset fields inherit. These helpers keep the item.display object tidy: when
 * every override is cleared, the `display` key is removed entirely so the JSON
 * doesn't carry an empty `{}`.
 */

import type { DisplayPrefs, PlaylistItem } from '@/types/dp1'

/** Set or clear one field on item.display. Removes the display key if no overrides remain. */
export function updateItemDisplay<K extends keyof DisplayPrefs>(
  item: PlaylistItem,
  field: K,
  value: DisplayPrefs[K] | undefined
): PlaylistItem {
  const next: DisplayPrefs = { ...(item.display ?? {}) }
  if (value === undefined) {
    delete next[field]
  } else {
    next[field] = value
  }
  if (Object.keys(next).length === 0) {
    const { display: _display, ...rest } = item
    return rest
  }
  return { ...item, display: next }
}
