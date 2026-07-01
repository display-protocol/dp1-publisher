import type { PlaylistItem } from '@/types/dp1'

/** Default manual row with no curator-entered content yet. */
export function isEmptyManualPlaceholder(item: PlaylistItem): boolean {
  if (item.source?.trim()) return false
  if (item.title?.trim()) return false
  if (item.ref?.trim()) return false
  if (item.slug?.trim()) return false
  if (item.provenance) return false
  if (item.note?.text?.trim()) return false
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
