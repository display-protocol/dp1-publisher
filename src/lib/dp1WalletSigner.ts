/**
 * Helpers that ensure the connected wallet's DID is *declared as a signer*
 * on a document before signing — i.e., the role-tagged signature has a
 * matching declared signer in the published payload.
 *
 * Without these, the feed rejects with "no valid curator signature found"
 * (playlists) or the publisher equivalent (channels) because it cannot
 * match the on-the-wire signature to a declared identity.
 */

import type { Channel, Playlist } from '@/types/dp1'

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
export function ensurePlaylistWalletCurator(
  playlist: Playlist,
  walletDID: string
): CuratorEnsureResult {
  const previousCount = playlist.curators?.length ?? 0
  const alreadyDeclared =
    playlist.curators?.some((c) => c.key === walletDID) ?? false

  if (alreadyDeclared) {
    return { playlist, injected: false, previousCount }
  }

  return {
    playlist: {
      ...playlist,
      curators: [
        ...(playlist.curators ?? []),
        { name: '', key: walletDID, url: '' },
      ],
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
  const previousKey = channel.publisher?.key
  if (previousKey === walletDID) {
    return { channel, updated: false, previousKey }
  }
  return {
    channel: {
      ...channel,
      publisher: {
        name: channel.publisher?.name ?? '',
        key: walletDID,
        url: channel.publisher?.url,
      },
    },
    updated: true,
    previousKey,
  }
}
