import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildReplaceIntent, INTENT_REFRESH_AFTER_MS } from './replaceIntent'
import { payloadHashString } from './signing'
import type { WalletClient } from 'viem'

/**
 * A wallet that returns a fixed 65-byte secp256k1 signature. The intent's cryptography is signDocument's
 * concern and is covered there; what matters here is the envelope built around it — the feed rejects a
 * replace whose intent names the wrong resource, hashes the wrong document, or is stale.
 */
const ADDRESS = '0x1111111111111111111111111111111111111111'
function walletStub(): { client: WalletClient; signed: { raw?: Uint8Array } } {
  const signed: { raw?: Uint8Array } = {}
  const client = {
    account: { address: ADDRESS },
    signMessage: vi.fn(async ({ message }: { message: { raw: Uint8Array } }) => {
      signed.raw = message.raw
      return `0x${'ab'.repeat(65)}` as const
    }),
  } as unknown as WalletClient
  return { client, signed }
}

const DOCUMENT = {
  dpVersion: '1.1.0',
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'season-one',
  title: 'Season One',
  created: '2026-05-20T08:30:00Z',
  items: [],
  signatures: [{ alg: 'eip191', kid: 'did:pkh:x', ts: 't', payload_hash: 'h', role: 'curator', sig: 's' }],
}

describe('buildReplaceIntent', () => {
  beforeEach(() => vi.clearAllMocks())

  it('names the resource the document identifies', async () => {
    const { client } = walletStub()
    const intent = await buildReplaceIntent({
      type: 'playlist',
      document: DOCUMENT,
      walletClient: client,
      role: 'curator',
    })
    expect(intent.action).toBe('replace')
    expect(intent.target).toEqual({
      type: 'playlist',
      id: '11111111-1111-4111-8111-111111111111',
      slug: 'season-one',
    })
  })

  // The hash is what stops a captured intent from installing different content the same owner signed at
  // some other time, so it must be the digest of this document, not of the intent.
  it('binds payloadHash to the document being installed', async () => {
    const { client } = walletStub()
    const intent = await buildReplaceIntent({
      type: 'playlist',
      document: DOCUMENT,
      walletClient: client,
      role: 'curator',
    })
    expect(intent.payloadHash).toBe(await payloadHashString(DOCUMENT))
    expect(intent.payloadHash).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  // The document's own signatures are public and replayable; freshness lives in the intent's `created`,
  // which is inside the payload the signature covers.
  it('carries a fresh RFC3339 created', async () => {
    const { client } = walletStub()
    const before = Date.now()
    const intent = await buildReplaceIntent({
      type: 'channel',
      document: DOCUMENT,
      walletClient: client,
      role: 'publisher',
    })
    const created = Date.parse(intent.created)
    expect(Number.isNaN(created)).toBe(false)
    expect(created).toBeGreaterThanOrEqual(before - 1000)
    expect(created).toBeLessThanOrEqual(Date.now() + 1000)
  })

  it('signs with the requested role and returns exactly one signature', async () => {
    const { client } = walletStub()
    const intent = await buildReplaceIntent({
      type: 'channel',
      document: DOCUMENT,
      walletClient: client,
      role: 'publisher',
    })
    expect(intent.signatures).toHaveLength(1)
    expect(intent.signatures[0].role).toBe('publisher')
    expect(intent.signatures[0].kid).toContain(ADDRESS.toLowerCase().slice(2, 10))
  })

  // The feed verifies the intent over its own bytes with `signatures` stripped. If the signature were
  // computed over a payload that already contained it, verification could never reproduce the digest.
  it('signs the intent without its own signatures field', async () => {
    const { client } = walletStub()
    const intent = await buildReplaceIntent({
      type: 'playlist',
      document: DOCUMENT,
      walletClient: client,
      role: 'curator',
    })
    const { signatures: _s, ...unsigned } = intent
    expect(intent.signatures[0].payload_hash).toBe(await payloadHashString(unsigned))
  })

  it.each([
    ['missing id', { ...DOCUMENT, id: undefined }],
    ['missing slug', { ...DOCUMENT, slug: undefined }],
    ['blank slug', { ...DOCUMENT, slug: '   ' }],
  ])('refuses to build an intent for a document %s', async (_name, doc) => {
    const { client } = walletStub()
    await expect(
      buildReplaceIntent({
        type: 'playlist',
        document: doc as Record<string, unknown>,
        walletClient: client,
        role: 'curator',
      })
    ).rejects.toThrow(/id and slug/i)
  })
})

/**
 * `created` must be stamped before signing, because the signature covers it. That puts a human-paced
 * wallet confirmation inside the freshness window, so an intent can be minutes old before it is even
 * signed — and the feed judges freshness on arrival.
 */
describe('buildReplaceIntent — slow wallet confirmation', () => {
  /** A wallet that advances the clock by `delayMs` before returning, as a real confirmation would. */
  function slowWallet(delayMs: number) {
    let calls = 0
    const client = {
      account: { address: ADDRESS },
      signMessage: vi.fn(async () => {
        calls += 1
        vi.setSystemTime(new Date(Date.now() + delayMs))
        return `0x${'ab'.repeat(65)}` as const
      }),
    } as unknown as WalletClient
    return { client, prompts: () => calls }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-20T08:00:00.000Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('re-stamps and re-signs when the confirmation eats too much of the window', async () => {
    const { client, prompts } = slowWallet(INTENT_REFRESH_AFTER_MS + 30_000)
    const onIntentRefresh = vi.fn()

    const intent = await buildReplaceIntent({
      type: 'playlist',
      document: DOCUMENT,
      walletClient: client,
      role: 'curator',
      onIntentRefresh,
    })

    expect(prompts()).toBe(2)
    expect(onIntentRefresh).toHaveBeenCalledTimes(1)
    // The returned intent carries the *second* timestamp, so what reaches the feed is the fresh one.
    const age = Date.now() - Date.parse(intent.created)
    expect(age).toBeLessThanOrEqual(INTENT_REFRESH_AFTER_MS + 30_000)
    expect(intent.signatures).toHaveLength(1)
  })

  it('does not prompt twice when the confirmation is prompt', async () => {
    const { client, prompts } = slowWallet(1_000)
    const onIntentRefresh = vi.fn()

    await buildReplaceIntent({
      type: 'playlist',
      document: DOCUMENT,
      walletClient: client,
      role: 'curator',
      onIntentRefresh,
    })

    expect(prompts()).toBe(1)
    expect(onIntentRefresh).not.toHaveBeenCalled()
  })

  // Retrying forever would be worse than failing: a user who is slow once is likely slow twice, and an
  // endless sequence of wallet prompts is indistinguishable from an attack.
  it('retries at most once even if the second confirmation is also slow', async () => {
    const { client, prompts } = slowWallet(INTENT_REFRESH_AFTER_MS + 30_000)

    await buildReplaceIntent({
      type: 'channel',
      document: DOCUMENT,
      walletClient: client,
      role: 'publisher',
    })

    expect(prompts()).toBe(2)
  })
})
