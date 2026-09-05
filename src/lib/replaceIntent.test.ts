import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildReplaceIntent } from './replaceIntent'
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
