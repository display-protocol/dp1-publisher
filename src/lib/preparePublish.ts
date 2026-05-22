/**
 * Single chokepoint between an authored document and the publish surface.
 *
 * Both forms (Playlist, Channel) and both modes (create, edit) in the publisher
 * end up needing the same pipeline:
 *
 *   raw document → merge with base (edit only) → strip extensions (off) →
 *   ensure signer identity → validate → return { signedPayload, wireBody, toasts }
 *
 * Splitting this across 4 call sites was the source of the round-6 channel-edit
 * drift bug: signed payload built from `merged.publisher`, but the PATCH body
 * built from `patchFields.publisher`. By computing **signedPayload and wireBody
 * together** here, that class of bug becomes impossible by construction —
 * callers cannot independently shape one without the other.
 */

import type { Channel, Playlist } from '@/types/dp1'
import { mergeChannelForPatch, mergePlaylistForPatch } from '@/lib/dp1Merge'
import { stripPlaylistExtensionFields } from '@/lib/dp1ExtensionPolicy'
import {
  ensureChannelWalletPublisher,
  ensurePlaylistWalletCurator,
} from '@/lib/dp1WalletSigner'
import { validateChannelFields } from '@/lib/channelValidation'

/** Shape compatible with the `useToast` hook's `toast({...})` call. */
export interface ToastInput {
  title: string
  description: string
  variant?: 'destructive'
}

export interface PreparedDocument<T> {
  /** What to canonicalize and pass to signDocument. */
  signedPayload: T
  /** What to POST/PATCH (caller adds `signatures` after signing). */
  wireBody: Record<string, unknown>
  /** Informational toasts the caller should show (e.g., "Wallet added as curator"). */
  toasts: ToastInput[]
}

export interface PrepareValidationFailure {
  validationErrors: string[]
}

export type PrepareResult<T> = PreparedDocument<T> | PrepareValidationFailure

// ----------------------------------------------------------------------------
// Playlist
// ----------------------------------------------------------------------------

export interface PreparePlaylistArgs {
  /** Document built from form state or parsed from imported JSON. */
  rawDocument: Playlist
  /** Connected wallet's DID (e.g., did:pkh:eip155:1:0x…). */
  walletDID: string
  /** For edit/PATCH; omit for create. */
  base?: Playlist
  /** Drives extension-field stripping and curator auto-inject behavior. */
  extensionsEnabled: boolean
}

export function preparePlaylistForPublish(
  args: PreparePlaylistArgs
): PrepareResult<Playlist> {
  const { rawDocument, walletDID, base, extensionsEnabled } = args
  const toasts: ToastInput[] = []

  // Step 1: merge with base (edit) or use raw verbatim (create).
  const merged: Playlist = base ? mergePlaylistForPatch(base, rawDocument) : rawDocument

  // Step 2: strip extension fields when extensions are off.
  let canonical: Playlist = extensionsEnabled
    ? merged
    : stripPlaylistExtensionFields(merged)

  // Step 3: ensure the connected wallet is declared as a curator. Only
  // meaningful when extensions are enabled — `curators[]` is an extension
  // field; with extensions off the feed doesn't read it.
  if (extensionsEnabled) {
    const ensured = ensurePlaylistWalletCurator(canonical, walletDID)
    canonical = ensured.playlist
    if (ensured.injected) {
      toasts.push({
        title: ensured.previousCount === 0 ? 'Curator auto-added' : 'Wallet added as curator',
        description:
          ensured.previousCount === 0
            ? 'No curators declared on the document — signing with your connected wallet as the curator.'
            : 'Document declares other curators; appending your connected wallet so the curator-role signature verifies.',
      })
    }
  }

  // Step 4: minimal post-merge validation. Schema-level validation already
  // happened upstream (parsePlaylistJson / form `required` attrs); this is a
  // defensive backstop for shapes that bypassed it.
  const validationErrors: string[] = []
  if (!canonical.title || typeof canonical.title !== 'string' || canonical.title.trim() === '') {
    validationErrors.push('Title is required.')
  }
  if (!Array.isArray(canonical.items)) {
    validationErrors.push('Items must be an array.')
  }
  if (validationErrors.length) return { validationErrors }

  // Step 5: build wire body from the canonical document. By construction this
  // matches the signed payload — they're computed from the same source.
  const wireBody: Record<string, unknown> = {
    dpVersion: canonical.dpVersion,
    title: canonical.title,
    slug: canonical.slug ?? '',
    items: canonical.items,
  }
  if (canonical.defaults !== undefined) wireBody.defaults = canonical.defaults
  if (extensionsEnabled) {
    if (canonical.curators && canonical.curators.length > 0) {
      wireBody.curators = canonical.curators
    }
    if (canonical.summary !== undefined) wireBody.summary = canonical.summary
    if (canonical.coverImage !== undefined) wireBody.coverImage = canonical.coverImage
    if (canonical.dynamicQuery !== undefined) wireBody.dynamicQuery = canonical.dynamicQuery
    if (canonical.note !== undefined) wireBody.note = canonical.note
  }

  return { signedPayload: canonical, wireBody, toasts }
}

// ----------------------------------------------------------------------------
// Channel
// ----------------------------------------------------------------------------

export interface PrepareChannelArgs {
  rawDocument: Channel
  walletDID: string
  base?: Channel
}

export function prepareChannelForPublish(
  args: PrepareChannelArgs
): PrepareResult<Channel> {
  const { rawDocument, walletDID, base } = args
  const toasts: ToastInput[] = []

  // Step 1: merge or pass through.
  let merged: Channel = base ? mergeChannelForPatch(base, rawDocument) : rawDocument

  // Step 2: ensure publisher.key matches the connected wallet. Channel has a
  // single publisher (vs. playlist's curator array), so the right behavior is
  // replace the key, preserve the name/url.
  const ensured = ensureChannelWalletPublisher(merged, walletDID)
  merged = ensured.channel
  if (ensured.updated) {
    toasts.push({
      title: ensured.previousKey ? 'Publisher key updated' : 'Publisher added',
      description: ensured.previousKey
        ? `Publisher key set to your connected wallet (was ${ensured.previousKey.slice(0, 32)}…).`
        : 'No publisher declared — using your connected wallet as publisher. Add a publisher name in the Form tab.',
    })
  }

  // Step 3: validate the merged document (covers field rules and JSON-import
  // shape errors uniformly).
  const fieldErrors = validateChannelFields(merged)
  if (fieldErrors.length > 0) {
    return { validationErrors: fieldErrors.map((e) => e.message) }
  }

  // Step 4: build wire body from the merged document (the same source the
  // signed payload is built from). Channel edit's round-6 bug came from
  // building this from the user's `patchFields.publisher` instead — the
  // imported (e.g., did:key) value — while signing the wallet-repaired
  // merged. Building both from `merged` makes drift impossible.
  const wireBody: Record<string, unknown> = {
    title: merged.title,
    slug: merged.slug,
    version: merged.version,
    playlists: merged.playlists,
    publisher: merged.publisher,
  }
  if (merged.curators !== undefined) wireBody.curators = merged.curators
  if (merged.summary !== undefined) wireBody.summary = merged.summary
  if (merged.coverImage !== undefined) wireBody.coverImage = merged.coverImage

  return { signedPayload: merged, wireBody, toasts }
}
