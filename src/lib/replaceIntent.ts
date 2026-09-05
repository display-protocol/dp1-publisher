/**
 * Signed mutation-intents for PUT (replace).
 *
 * The feed removed PATCH and now authorizes a replace with two independently signed halves:
 * `{ document, authorization }`. The document proves what is being installed; the authorization — this
 * intent — proves that an owner asked for *this* document to replace *this* resource, right now.
 *
 * Both are needed because a document's own signatures are public: anyone can read a previously published
 * playlist and replay it. The intent closes that, and the reason it can is that its `created` sits inside
 * its own signed payload. A signature's `ts` field does not — DP-1 §7.1 hashes the document with
 * `signatures` stripped — so `ts` is forgeable on a replayed body and cannot bound anything.
 *
 * The intent is signed by the same wallet that signs the document, because the feed only accepts a
 * signature whose `kid` is already an owner of the *stored* resource.
 */

import { payloadHashString, signDocument } from '@/lib/signing'
import type { Signature } from '@/types/dp1'
import type { WalletClient } from 'viem'

/** Resource kinds this publisher can replace. Mirrors the feed's intent target types. */
export type IntentTargetType = 'playlist' | 'channel'

export interface SignedIntent {
  action: 'replace'
  target: { type: IntentTargetType; id: string; slug: string }
  /** DP-1 signing digest of the document this intent authorizes ("sha256:<hex>"). */
  payloadHash: string
  /** RFC3339. Must be inside the feed's `auth.intent_max_clock_skew` (5 minutes by default). */
  created: string
  signatures: Signature[]
}

/**
 * How much of the feed's freshness window may be spent on the wallet confirmation before the intent is
 * re-stamped and re-signed.
 *
 * The feed's default `auth.intent_max_clock_skew` is five minutes. Two minutes leaves a wide margin for
 * the request itself and for clock drift between this browser and the server, which the same window has
 * to absorb — the check is on the absolute difference, so a fast client with a slow clock is as much a
 * problem as a slow user.
 */
export const INTENT_REFRESH_AFTER_MS = 2 * 60 * 1000

export interface BuildReplaceIntentArgs {
  type: IntentTargetType
  /** The complete signed document being installed — the same bytes sent as `document`. */
  document: Record<string, unknown>
  walletClient: WalletClient
  role: 'curator' | 'publisher'
  /**
   * Called when the confirmation took long enough that the intent is being re-stamped and signed again.
   * The caller uses it to explain the second prompt — an unexplained repeat request looks like a bug or,
   * worse, like something trying to get a second signature out of the user.
   */
  onIntentRefresh?: () => void
}

/**
 * Build the signed intent authorizing `document` to replace the resource it identifies.
 *
 * The target is read from the document rather than passed separately, and deliberately so: the feed
 * requires the submitted `id` and `slug` to equal the stored resource's, and the intent's target to name
 * that same resource. Deriving both from one source means they cannot disagree with each other — if they
 * disagree with the *stored* resource the feed rejects the write, which is the intended outcome.
 */
export async function buildReplaceIntent({
  type,
  document,
  walletClient,
  role,
  onIntentRefresh,
}: BuildReplaceIntentArgs): Promise<SignedIntent> {
  const id = typeof document.id === 'string' ? document.id.trim() : ''
  const slug = typeof document.slug === 'string' ? document.slug.trim() : ''
  if (!id || !slug) {
    throw new Error('Replace requires a document carrying both id and slug')
  }

  // payloadHash binds this intent to these exact document bytes, so a captured intent cannot be reused
  // to install different content the same owner signed at some other time.
  const payloadHash = await payloadHashString(document)

  // `created` has to be stamped before signing, because the signature covers it — that is the whole
  // reason it can bound replay, where a signature's own `ts` cannot. But signing here means waiting on a
  // wallet confirmation, which is paced by a person: a hardware wallet, a locked screen, a phone in
  // another room. The intent can therefore be minutes old by the time it is signed, and the feed judges
  // freshness on arrival, so a replace could fail for no reason except how long someone took to approve.
  //
  // So the age is measured across the confirmation and the intent re-stamped if too much of the window
  // has gone. Only the intent is re-signed; the document's signature does not expire, so the user is not
  // asked to redo that. One retry only: if the second confirmation is also slow, sending the fresher of
  // the two and letting the feed answer is better than prompting forever.
  const attempt = async (): Promise<{ intent: SignedIntent; ageMs: number }> => {
    const unsigned = {
      action: 'replace' as const,
      target: { type, id, slug },
      payloadHash,
      created: new Date().toISOString(),
    }
    const startedAt = Date.parse(unsigned.created)
    // Signed over the intent with `signatures` stripped — the same rule the document itself follows,
    // which is what lets the feed verify both halves with one code path.
    const signature = await signDocument(unsigned, walletClient, role)
    return { intent: { ...unsigned, signatures: [signature] }, ageMs: Date.now() - startedAt }
  }

  const first = await attempt()
  if (first.ageMs <= INTENT_REFRESH_AFTER_MS) return first.intent

  onIntentRefresh?.()
  const second = await attempt()
  return second.intent
}
