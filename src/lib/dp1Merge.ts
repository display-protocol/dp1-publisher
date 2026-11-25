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
    openAt?: string
    links?: Playlist['links']
    visibility?: string
    satellites?: Playlist['satellites']
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
    // An edit that states one of these wins over the stored value; one that
    // leaves it out keeps the stored value (the spread above), so a form edit
    // never erases an unlisted playlist's `visibility`.
    openAt: patch.openAt !== undefined ? patch.openAt : existing.openAt,
    links: patch.links !== undefined ? patch.links : existing.links,
    visibility: patch.visibility !== undefined ? patch.visibility : existing.visibility,
    satellites: patch.satellites !== undefined ? patch.satellites : existing.satellites,
  }
}

/**
 * Lay the Form tab's own values over the document the form was loaded or
 * imported from, so members the form has no control for survive a form-built
 * publish.
 *
 * The form rebuilds `note` and `defaults` from its handful of inputs and has no
 * input at all for `openAt` / `links` / `visibility` / `satellites`, so a
 * document built from form state alone silently loses `note.title`,
 * `note.author`, `defaults.display.imageRendering` (and `interaction`, `margin`,
 * `userOverrides`) and, worst, `visibility: "unlisted"` — absent means public.
 *
 * Rules: the four top-level members come from `retained` only when the form
 * did not state them (it never does); `note` and `defaults` (+ `defaults.display`)
 * are merged one level, form keys winning — a key the form states as `undefined`
 * (a cleared input) therefore still clears it. `note`/`defaults` the form did
 * not emit (extensions off) are not re-added. The JSON tab does not go through
 * this: it submits the document as written.
 */
export function overlayPlaylistFormEdits<
  T extends Pick<Playlist, 'note' | 'defaults'> &
    Partial<Pick<Playlist, 'openAt' | 'links' | 'visibility' | 'satellites'>>,
>(
  retained: Playlist | null | undefined,
  form: T
): T & Partial<Pick<Playlist, 'openAt' | 'links' | 'visibility' | 'satellites'>> {
  if (!retained) return form
  const out: ReturnType<typeof overlayPlaylistFormEdits<T>> = { ...form }
  if (out.openAt === undefined && retained.openAt !== undefined) out.openAt = retained.openAt
  if (out.links === undefined && retained.links !== undefined) out.links = retained.links
  if (out.visibility === undefined && retained.visibility !== undefined) {
    out.visibility = retained.visibility
  }
  if (out.satellites === undefined && retained.satellites !== undefined) {
    out.satellites = retained.satellites
  }
  if (form.note && retained.note) out.note = { ...retained.note, ...form.note }
  if (form.defaults && retained.defaults) {
    out.defaults = {
      ...retained.defaults,
      ...form.defaults,
      ...(form.defaults.display && retained.defaults.display
        ? { display: { ...retained.defaults.display, ...form.defaults.display } }
        : {}),
    }
  }
  return out
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
