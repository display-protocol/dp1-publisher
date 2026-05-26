/**
 * Client-side gate that decides whether the connected wallet is allowed to
 * silently overwrite an already-published DP-1 document.
 *
 * Without this check, the auto-overwrite path would call `prepare*ForPublish`
 * with the existing document as `base`, which rewrites publisher/curator
 * identity to the connected wallet and then asks the user to sign that
 * rewritten payload. That sequence is unsafe: it produces a payload the user
 * is signing under false pretenses (the on-screen flow looks like a
 * silent overwrite, but the bytes attest to a different identity). The
 * server would presumably reject the resulting PATCH, but we should never
 * ask the user to sign in the first place.
 *
 * The gate is intentionally strict: the connected wallet must have already
 * signed the existing document in the appropriate role. We do not infer
 * authority from `curators[]` or `publisher.key` because those fields can be
 * authored arbitrarily; only an existing signature is proof of historical
 * possession.
 */
import type { Signature } from '@/types/dp1'

export type OwnershipRole = 'curator' | 'publisher'

export function isWalletAuthorizedToOverwrite(
  existing: { signatures?: Signature[] } | undefined | null,
  role: OwnershipRole,
  walletDID: string
): boolean {
  if (!existing?.signatures || existing.signatures.length === 0) return false
  return existing.signatures.some((s) => s.role === role && s.kid === walletDID)
}

/** Friendly error string for the gate's reject path. Kept inline so callers
 *  don't have to fabricate a FeedAPIError just to reuse friendlyPublishError. */
export function wrongWalletForOverwriteMessage(
  noun: 'playlist' | 'channel' | 'playlist group'
): string {
  return `This ${noun} was published by a different wallet. Connect that wallet to update it, or publish under a new id.`
}
