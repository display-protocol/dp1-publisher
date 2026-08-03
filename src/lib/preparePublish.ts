/**
 * Single chokepoint between an authored document and the publish surface.
 *
 * All publish forms (Playlist, Channel) and both modes (create,
 * edit) end up needing the same core pipeline:
 *
 *   raw document → merge with base (edit only) → [strip extensions (playlist, off)] →
 *   ensure signer identity → validate → canonicalize once → derive wireBody from signedBytes
 *
 * Splitting this across 4 call sites was the source of the round-6 channel-edit
 * drift bug: signed payload built from `merged.publisher`, but the PATCH body
 * built from `patchFields.publisher`. By computing **signedPayload and wireBody
 * together** here, that class of bug becomes impossible by construction —
 * callers cannot independently shape one without the other.
 */

import type { Channel, Playlist } from '@/types/dp1'
import {
  mergeChannelForPatch,
  mergePlaylistForPatch,
} from '@/lib/dp1Merge'
import { stripPlaylistExtensionFields } from '@/lib/dp1ExtensionPolicy'
import {
  ensureChannelWalletPublisher,
  ensurePlaylistWalletCurator,
  normalizeChannelCurators,
} from '@/lib/dp1WalletSigner'
import { validateChannelFields } from '@/lib/channelValidation'
import { playlistUnsignedPayloadForSigning } from '@/lib/playlistSignPayload'
import { channelUnsignedPayloadForSigning } from '@/lib/channelSignPayload'

/** Shape compatible with the `useToast` hook's `toast({...})` call. */
export interface ToastInput {
  title: string
  description: string
  variant?: 'destructive'
}

export interface PreparedDocument<T> {
  /**
   * Typed canonical document (after merge/strip/ensure). Mostly informational
   * for callers; the source of truth for both signing and wire is `signedBytes`.
   */
  signedPayload: T
  /**
   * The exact canonical JSON object that gets hashed for the signature
   * (output of `*UnsignedPayloadForSigning`). Pass directly to `signDocument`.
   * Always includes `id` and `created`.
   */
  signedBytes: Record<string, unknown>
  /**
   * What to POST/PATCH (caller adds `signatures`).
   *   - CREATE: equals `signedBytes` exactly — the POST body matches the
   *     bytes the feed will hash to verify the signature.
   *   - EDIT (PATCH): `signedBytes` minus `id` (URL path) and `created`
   *     (immutable). These are the only documented PATCH omissions.
   * Derived from `signedBytes`, so it cannot drift from what was signed
   * except in the documented ways above.
   */
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
  /** Optional attribution: fills the injected curator's empty name. */
  walletName?: string
}

export function preparePlaylistForPublish(
  args: PreparePlaylistArgs
): PrepareResult<Playlist> {
  const { rawDocument, walletDID, base, extensionsEnabled, walletName } = args
  const toasts: ToastInput[] = []

  // Step 1: merge with base (edit) or use raw verbatim (create).
  let merged: Playlist = base ? mergePlaylistForPatch(base, rawDocument) : rawDocument

  // Step 1b: create-only schema defaults. Must run after merge — injecting
  // dpVersion before merge would make mergePlaylistForPatch treat the default
  // as an intentional patch value and overwrite existing metadata on edit.
  if (!base) {
    merged = {
      ...merged,
      dpVersion:
        typeof merged.dpVersion === 'string' && merged.dpVersion.trim() !== ''
          ? merged.dpVersion.trim()
          : '1.1.0',
    }
  }

  // Step 2: strip extension fields when extensions are off.
  let canonical: Playlist = extensionsEnabled
    ? merged
    : stripPlaylistExtensionFields(merged)

  // Step 3: ensure the connected wallet is declared as a curator. Only
  // meaningful when extensions are enabled — `curators[]` is an extension
  // field; with extensions off the feed doesn't read it.
  if (extensionsEnabled) {
    const ensured = ensurePlaylistWalletCurator(canonical, walletDID, walletName)
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

  // Step 5: canonicalize ONCE. `playlistUnsignedPayloadForSigning` is the
  // single source of truth for the exact bytes the feed will hash. wireBody
  // is derived from it, so it can't drift from what was signed except in the
  // intentional PATCH omissions below.
  const signedBytes = playlistUnsignedPayloadForSigning(canonical)

  // The signer defaults the slug (generateSlug) when the document lacks one —
  // the review-and-sign paste path never runs the form's slug generation.
  // Mirror the resolved slug back onto the typed document so the review
  // summary shows the final feed URL, and tell the user when we filled it in.
  const resolvedSlug = signedBytes.slug
  if (typeof resolvedSlug === 'string') {
    if (!canonical.slug?.trim()) {
      toasts.push({
        title: 'Slug set automatically',
        description: `This playlist will publish as "${resolvedSlug}". Future updates keep the same URL.`,
      })
    }
    canonical = { ...canonical, slug: resolvedSlug }
  }

  const wireBody: Record<string, unknown> = { ...signedBytes }
  if (base !== undefined) {
    // PATCH: id is in the URL path, created is immutable.
    delete wireBody.id
    delete wireBody.created
  }

  return { signedPayload: canonical, signedBytes, wireBody, toasts }
}

// ----------------------------------------------------------------------------
// Channel
// ----------------------------------------------------------------------------

export interface PrepareChannelArgs {
  rawDocument: Channel
  walletDID: string
  base?: Channel
  /** Optional attribution: publisher name fallback when the document has none. */
  walletName?: string
}

export function prepareChannelForPublish(
  args: PrepareChannelArgs
): PrepareResult<Channel> {
  const { rawDocument, walletDID, base, walletName } = args
  const toasts: ToastInput[] = []

  // Step 1: merge or pass through.
  let merged: Channel = base ? mergeChannelForPatch(base, rawDocument) : rawDocument

  // Step 1b: create-only schema defaults (same rationale as playlist dpVersion).
  if (!base) {
    merged = {
      ...merged,
      version:
        typeof merged.version === 'string' && merged.version.trim() !== ''
          ? merged.version.trim()
          : '1.0.0',
    }
  }

  // Step 2: ensure publisher.key matches the connected wallet. Channel has a
  // single publisher (vs. playlist's curator array), so the right behavior is
  // replace the key, preserve the name/url.
  const ensured = ensureChannelWalletPublisher(merged, walletDID, walletName)
  merged = ensured.channel
  merged = normalizeChannelCurators(merged)
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

  // Step 4: canonicalize ONCE. `channelUnsignedPayloadForSigning` is the
  // single source of truth for the exact bytes the feed will hash (slug
  // auto-generation, default version, entity URL normalization, blank
  // stripping all live there). wireBody is derived from it, so it cannot
  // drift from what was signed except in the intentional PATCH omissions
  // below.
  let signedBytes: Record<string, unknown>
  try {
    signedBytes = channelUnsignedPayloadForSigning(merged)
  } catch (e) {
    return {
      validationErrors: [
        e instanceof Error ? e.message : 'Channel could not be canonicalized for signing.',
      ],
    }
  }
  const wireBody: Record<string, unknown> = { ...signedBytes }
  if (base !== undefined) {
    // PATCH: id is in the URL path, created is immutable.
    delete wireBody.id
    delete wireBody.created
  }

  return { signedPayload: merged, signedBytes, wireBody, toasts }
}

// ----------------------------------------------------------------------------
// Playlist group
// ----------------------------------------------------------------------------

