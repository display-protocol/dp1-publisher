import type { PlaylistItem } from '@/types/dp1'

/**
 * Returns true only when the item is the auto-generated blank row the form opens
 * with — no id and no curator-entered content. Every user-editable field on
 * PlaylistItem must be checked here; missing a field means a partially-filled or
 * previously-persisted row could be silently dropped from the signed/exported
 * playlist when a series is also loaded.
 *
 * Critically, items loaded from the feed in edit mode carry an id, so they must
 * never be treated as disposable placeholders even if the curator clears their
 * source field mid-edit.
 */
export function isEmptyManualPlaceholder(item: PlaylistItem): boolean {
  if (item.id?.trim()) return false
  if (item.source?.trim()) return false
  if (item.title?.trim()) return false
  if (item.ref?.trim()) return false
  if (item.slug?.trim()) return false
  if (item.duration != null) return false
  if (item.license != null) return false
  if (item.override != null) return false
  if (item.repro != null) return false
  if (item.provenance) return false
  if (item.note?.text?.trim()) return false
  if (item.displayAt?.trim()) return false
  if (item.display && Object.keys(item.display).length > 0) return false
  return true
}

/**
 * When series (or other substantive items) are present, drop the initial empty
 * manual placeholder so publish/JSON export does not emit a blank leaf alongside
 * real items.
 */
export function itemsForPlaylistExport(items: PlaylistItem[]): PlaylistItem[] {
  const hasSubstantive = items.some((item) => !isEmptyManualPlaceholder(item))
  if (!hasSubstantive || items.length === 0) return items
  if (isEmptyManualPlaceholder(items[0])) return items.slice(1)
  return items
}

/** Count items that would be included in the signed playlist. */
export function playlistItemExportCount(items: PlaylistItem[]): number {
  return itemsForPlaylistExport(items).length
}

/**
 * Count items that carry real curator-entered content (not the default empty
 * manual placeholder). Used for the series-replace confirmation gate so that
 * a fresh blank playlist does not trigger a "replace 1 item" warning.
 */
export function substantiveItemCount(items: PlaylistItem[]): number {
  return items.filter((item) => !isEmptyManualPlaceholder(item)).length
}
