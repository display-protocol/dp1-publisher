/**
 * Helpers that ensure the connected wallet's DID is *declared as a signer*
 * on a document before signing — i.e., the role-tagged signature has a
 * matching declared signer in the published payload.
 *
 * Without these, the feed rejects with "no valid curator signature found"
 * (playlists, playlist groups) or the publisher equivalent (channels) because
 * it cannot match the on-the-wire signature to a declared identity.
 */

import type { Channel, Entity, Playlist } from '@/types/dp1'

export interface CuratorEnsureResult {
  playlist: Playlist
  /** True when the wallet DID was newly added to `curators[]`. */
  injected: boolean
  /** Pre-existing curator count (0 if `curators` was missing). */
  previousCount: number
}

/**
 * Append the connected wallet's DID to `playlist.curators[]` if not already present.
 *
 * Handles all three failure modes the feed treats identically:
 * - `curators` missing → create `[{ key: walletDID }]`
 * - `curators` empty → append wallet
 * - `curators` non-empty, wallet absent (e.g., a `did:key` curator left over
 *   from `dp1-cli` signing) → append the wallet alongside the existing entries
 *
 * No-op when the wallet is already declared (idempotent on re-imports).
 */
/**
 * True when the value looks like a curator with a non-empty string `key`.
 * Used as a runtime filter at the JSON boundary, since `parsePlaylistJson`
 * doesn't type-check `curators[]`.
 */
function hasValidKey(c: unknown): c is { key: string } {
  return (
    !!c &&
    typeof c === 'object' &&
    typeof (c as { key?: unknown }).key === 'string' &&
    ((c as { key: string }).key as string).length > 0
  )
}

/**
 * Normalize a curator-like value to the wire shape `{ name, key, url? }`:
 * defaults missing or non-string `name` to `''` so the entity wire layer
 * never emits `name: undefined` (which JSON.stringify drops, contradicting
 * the wire contract that `name` is always emitted). Defaults non-string
 * `url` to undefined.
 */
function normalizeCurator(c: unknown): Entity {
  const o = c as { name?: unknown; key?: unknown; url?: unknown }
  return {
    name: typeof o.name === 'string' ? o.name : '',
    key: o.key as string, // hasValidKey guarantees key is a string
    url: typeof o.url === 'string' ? o.url : undefined,
  }
}

/**
 * Normalize channel `curators[]` entries to the wire entity shape, mirroring
 * playlist curator handling in `ensurePlaylistWalletCurator`.
 */
export function normalizeChannelCurators(channel: Channel): Channel {
  if (!Array.isArray(channel.curators)) return channel
  return {
    ...channel,
    curators: channel.curators.map((c) => (hasValidKey(c) ? normalizeCurator(c) : c)),
  }
}

export function ensurePlaylistWalletCurator(
  playlist: Playlist,
  walletDID: string
): CuratorEnsureResult {
  // Defensive: `parsePlaylistJson` only validates `title` and `items`, so an
  // imported playlist's `curators` can be any shape — object, null, array
  // with nulls, entries missing `name`, etc. Coerce to a clean Entity[] up
  // front so the helper and downstream signing can't crash on garbage from
  // the JSON boundary, AND so preserved entries are normalized (no
  // `name: undefined` slipping into the wire payload).
  const rawArray: unknown[] = Array.isArray(playlist.curators) ? playlist.curators : []
  const validCurators: Entity[] = rawArray.filter(hasValidKey).map(normalizeCurator)

  const previousCount = validCurators.length
  const alreadyDeclared = validCurators.some((c) => c.key === walletDID)

  if (alreadyDeclared) {
    return {
      playlist: { ...playlist, curators: validCurators },
      injected: false,
      previousCount,
    }
  }

  return {
    playlist: {
      ...playlist,
      curators: [...validCurators, { name: '', key: walletDID, url: '' }],
    },
    injected: true,
    previousCount,
  }
}

export interface PublisherEnsureResult {
  channel: Channel
  /** True when `publisher.key` was changed (added or replaced). */
  updated: boolean
  /** The previous `publisher.key`, if any (so callers can show it in a toast). */
  previousKey?: string
}

/**
 * Ensure `channel.publisher.key` matches the connected wallet's DID.
 *
 * The channel has a single publisher (vs. the playlist's curator array), so
 * the right behavior is *replace the key, preserve the name/url*. That lets
 * a partner channel originally signed under `did:key` (e.g., via `dp1-cli`)
 * be re-signed under the partner's wallet `did:pkh` without hand-editing
 * the publisher fields the partner cares about (name, homepage URL).
 *
 * No-op when the publisher key already matches the wallet.
 */
export function ensureChannelWalletPublisher(
  channel: Channel,
  walletDID: string
): PublisherEnsureResult {
  // Defensive against malformed JSON-imported publishers: `parseChannelJson`
  // only validates `title` and `playlists`, so `publisher` can arrive as a
  // non-object or carry non-string fields. Coerce up front so the helper
  // (and the toast that uses `previousKey.slice(...)` in the caller) can't
  // crash on garbage from the JSON boundary.
  const rawPublisher = channel.publisher
  const isObjectPublisher =
    !!rawPublisher && typeof rawPublisher === 'object' && !Array.isArray(rawPublisher)
  const p = isObjectPublisher
    ? (rawPublisher as { name?: unknown; key?: unknown; url?: unknown })
    : {}
  const previousKey = typeof p.key === 'string' ? p.key : undefined

  if (previousKey === walletDID) {
    return { channel, updated: false, previousKey }
  }
  return {
    channel: {
      ...channel,
      publisher: {
        name: typeof p.name === 'string' ? p.name : '',
        key: walletDID,
        url: typeof p.url === 'string' ? p.url : undefined,
      },
    },
    updated: true,
    previousKey,
  }
}

