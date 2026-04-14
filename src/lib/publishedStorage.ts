/**
 * Local registry of playlists/channels published from this browser, keyed by wallet address.
 * Rows are lightweight list metadata only (id, slug, title, created). Editing always refetches
 * the full document via GET /api/v1/... — never use these records as the merge base for PATCH.
 */

import { getAddress } from 'viem'
import type { Channel, Playlist } from '@/types/dp1'

const STORAGE_KEY = 'ff-publisher:published:v1'

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
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { byAddress: {} }
    const p = JSON.parse(raw) as Root
    if (!p || typeof p !== 'object' || !p.byAddress) return { byAddress: {} }
    return p
  } catch {
    return { byAddress: {} }
  }
}

function writeRoot(root: Root) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(root))
}

function addrKey(address: string): string {
  return getAddress(address).toLowerCase()
}

function toRecord(
  kind: 'playlist' | 'channel',
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

export function loadPublished(address: string): AddressBucket {
  const root = readRoot()
  const b = root.byAddress[addrKey(address)]
  if (!b) return emptyBucket()
  return {
    playlists: dedupeById(b.playlists.filter((x) => x.kind === 'playlist')),
    channels: dedupeById(b.channels.filter((x) => x.kind === 'channel')),
  }
}

export function savePublished(address: string, bucket: AddressBucket) {
  const root = readRoot()
  root.byAddress[addrKey(address)] = {
    playlists: dedupeById(bucket.playlists),
    channels: dedupeById(bucket.channels),
  }
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
