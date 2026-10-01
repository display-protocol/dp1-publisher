/**
 * Resolve what a user pastes to open a playlist for edit — a feed resource URL
 * (`…/api/v1/playlists/<id-or-slug>`), a bare UUID or a bare slug — to the
 * id-or-slug the feed's GET/PUT `/api/v1/playlists/{id}` accept.
 *
 * Exists for core-only feeds: there `curators` is stripped at publish, so the
 * feed's `?curator=` list can never return the wallet's playlists, and opening
 * by reference is the only cross-browser way back to them. The host is not
 * checked: the edit flow always loads from this app's configured feed, so a URL
 * from another feed simply resolves to a 404 there rather than to a foreign write.
 *
 * Returns null when the input cannot name a playlist.
 */
export function parsePlaylistReference(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null

  if (/^https?:\/\//i.test(raw)) {
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      return null
    }
    const m = url.pathname.match(/\/api\/v1\/playlists\/([^/]+)\/?$/)
    if (!m) return null
    try {
      return decodeURIComponent(m[1]).trim() || null
    } catch {
      return null
    }
  }

  // A bare id or slug is a single path segment; anything with separators or
  // whitespace is not something the feed could have minted.
  return /^[^\s/?#]+$/.test(raw) ? raw : null
}
