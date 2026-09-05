/**
 * Local registry of playlists and channels published from this browser,
 * keyed by wallet address. Rows are lightweight list metadata only (id, slug, title, created).
 * Editing always refetches the full document via GET /api/v1/... — never use these records as the merge
 * base for a replace: a replace sends the whole document, so a stale base would silently drop fields.
 */

import { getAddress } from 'viem'
import type { Channel, Playlist } from '@/types/dp1'

/** Current key for per-wallet published-metadata registry. */
const STORAGE_KEY = 'dp1-publisher:published:v2'
/** Prior v2 key when the repo/npm package was `ff-publisher`; migrated on read. */
const LEGACY_STORAGE_KEY_V2 = 'ff-publisher:published:v2'
/** Original v1 layout, before the (since removed) playlist-group list. */
const LEGACY_STORAGE_KEY_V1 = 'ff-publisher:published:v1'

export type PublishedRecord = {
  kind: 'playlist' | 'channel'
  id: string
  slug?: string
  title: string
  created?: string
}

type AddressBucket = {
  playlists: PublishedRecord[]
  channels: PublishedRecord[]
}

type Root = {
  byAddress: Record<string, AddressBucket>
}

function emptyBucket(): AddressBucket {
  return { playlists: [], channels: [] }
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

/** Migrate the original v1 layout onto the current key. */
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
  doc: Pick<Playlist | Channel, 'id' | 'slug' | 'title' | 'created'>
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
    // Filtering by kind is also how blobs written before playlist-groups were
    // removed degrade: any stored group row is dropped on read rather than
    // surfacing a document type this app can no longer open.
    playlists: dedupeById((b.playlists ?? []).filter((x) => x?.kind === 'playlist')),
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
