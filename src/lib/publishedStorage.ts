/**
 * Local registry of playlists, playlist-groups, and channels published from this browser,
 * keyed by wallet address. Rows are lightweight list metadata only (id, slug, title, created).
 * Editing always refetches the full document via GET /api/v1/... — never use these records as the merge base for PATCH.
 */

import { getAddress } from 'viem'
import type { Channel, Playlist, PlaylistGroup } from '@/types/dp1'

/** Current key for per-wallet published-metadata registry. */
const STORAGE_KEY = 'dp1-publisher:published:v2'
/** Prior v2 key when the repo/npm package was `ff-publisher`; migrated on read. */
const LEGACY_STORAGE_KEY_V2 = 'ff-publisher:published:v2'
/** Original v1 layout (no playlistGroups). */
const LEGACY_STORAGE_KEY_V1 = 'ff-publisher:published:v1'

export type PublishedRecord = {
  kind: 'playlist' | 'playlist-group' | 'channel'
  id: string
  slug?: string
  title: string
  created?: string
}

type AddressBucket = {
  playlists: PublishedRecord[]
  playlistGroups: PublishedRecord[]
  channels: PublishedRecord[]
}

type Root = {
  byAddress: Record<string, AddressBucket>
}

function emptyBucket(): AddressBucket {
  return { playlists: [], playlistGroups: [], channels: [] }
}

function readRoot(): Root {
  try {
    let raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      raw = localStorage.getItem(LEGACY_STORAGE_KEY_V2)
      if (raw) {
        localStorage.setItem(STORAGE_KEY, raw)
        localStorage.removeItem(LEGACY_STORAGE_KEY_V2)
      }
    }
    if (!raw) return { byAddress: {} }
    const p = JSON.parse(raw) as Root
    if (!p || typeof p !== 'object' || !p.byAddress) return { byAddress: {} }
    return p
  } catch {
    return { byAddress: {} }
  }
}

/** Migrate v1 layout (no playlistGroups) to v2 with three lists. */
function readRootWithMigration(): Root {
  try {
    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY_V1)
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as {
        byAddress?: Record<
          string,
          { playlists?: PublishedRecord[]; channels?: PublishedRecord[] }
        >
      }
      if (legacy?.byAddress && typeof legacy.byAddress === 'object') {
        const byAddress: Record<string, AddressBucket> = {}
        for (const [addr, b] of Object.entries(legacy.byAddress)) {
          byAddress[addr] = {
            playlists: dedupeById(
              (b.playlists ?? []).filter((x) => x && x.kind === 'playlist')
            ),
            playlistGroups: [],
            channels: dedupeById((b.channels ?? []).filter((x) => x && x.kind === 'channel')),
          }
        }
        const next: Root = { byAddress }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
        localStorage.removeItem(LEGACY_STORAGE_KEY_V1)
        return next
      }
    }
  } catch {
    // ignore migration errors
  }
  return readRoot()
}

function writeRoot(root: Root) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(root))
}

function addrKey(address: string): string {
  return getAddress(address).toLowerCase()
}

function toRecord(
  kind: PublishedRecord['kind'],
  doc: Pick<Playlist | Channel | PlaylistGroup, 'id' | 'slug' | 'title' | 'created'>
): PublishedRecord {
  return {
    kind,
    id: doc.id ?? '',
    slug: doc.slug,
    title: doc.title,
    created: doc.created,
  }
}

function dedupeById(list: PublishedRecord[]): PublishedRecord[] {
  const seen = new Set<string>()
  const out: PublishedRecord[] = []
  for (const r of list) {
    if (!r.id || seen.has(r.id)) continue
    seen.add(r.id)
    out.push(r)
  }
  return out
}

function normalizeBucket(b: Partial<AddressBucket> | undefined): AddressBucket {
  if (!b) return emptyBucket()
  return {
    playlists: dedupeById((b.playlists ?? []).filter((x) => x?.kind === 'playlist')),
    playlistGroups: dedupeById(
      (b.playlistGroups ?? []).filter((x) => x?.kind === 'playlist-group')
    ),
    channels: dedupeById((b.channels ?? []).filter((x) => x?.kind === 'channel')),
  }
}

export function loadPublished(address: string): AddressBucket {
  const root = readRootWithMigration()
  const b = root.byAddress[addrKey(address)]
  return normalizeBucket(b)
}

export function savePublished(address: string, bucket: AddressBucket) {
  const root = readRootWithMigration()
  root.byAddress[addrKey(address)] = normalizeBucket(bucket)
  writeRoot(root)
}

export function recordPublishedPlaylist(
  address: string,
  doc: Pick<Playlist, 'id' | 'slug' | 'title' | 'created'>
) {
  if (!doc.id) return
  const cur = loadPublished(address)
  const rec = toRecord('playlist', doc)
  const rest = cur.playlists.filter((p) => p.id !== rec.id)
  savePublished(address, {
    ...cur,
    playlists: [rec, ...rest],
  })
}

export function recordPublishedPlaylistGroup(
  address: string,
  doc: Pick<PlaylistGroup, 'id' | 'slug' | 'title' | 'created'>
) {
  if (!doc.id) return
  const cur = loadPublished(address)
  const rec = toRecord('playlist-group', doc)
  const rest = cur.playlistGroups.filter((p) => p.id !== rec.id)
  savePublished(address, {
    ...cur,
    playlistGroups: [rec, ...rest],
  })
}

export function recordPublishedChannel(
  address: string,
  doc: Pick<Channel, 'id' | 'slug' | 'title' | 'created'>
) {
  if (!doc.id) return
  const cur = loadPublished(address)
  const rec = toRecord('channel', doc)
  const rest = cur.channels.filter((c) => c.id !== rec.id)
  savePublished(address, {
    ...cur,
    channels: [rec, ...rest],
  })
}

export function sortByCreatedDesc<T extends { created?: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ta = a.created ? Date.parse(a.created) : 0
    const tb = b.created ? Date.parse(b.created) : 0
    return tb - ta
  })
}
