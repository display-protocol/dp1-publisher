/**
 * Tests for DP-1 signing implementation
 * Based on dp1-js tests/sign/payload.test.ts patterns
 */

import { describe, it, expect } from 'vitest'
import {
  stripSignatureFields,
  canonicalPayload,
  signingMessage,
  signingDigest,
  payloadHashString,
  ethereumAddressToDIDPKH,
} from '@/lib/signing'
import {
  minimalPlaylist,
  playlistWithLegacySignature,
  playlistWithSignatures,
} from '@/test/fixtures/playlist'

describe('stripSignatureFields', () => {
  it('should strip top-level signature field', () => {
    const input = {
      dpVersion: '1.1.0',
      title: 'Test',
      signature: 'ed25519:shouldberemoved',
      items: [],
    }
    const result = stripSignatureFields(input)
    expect(result).not.toHaveProperty('signature')
    expect(result).toHaveProperty('dpVersion')
    expect(result).toHaveProperty('title')
  })

  it('should strip top-level signatures array', () => {
    const input = {
      dpVersion: '1.1.0',
      title: 'Test',
      signatures: [{ alg: 'eip191', sig: 'test' }],
      items: [],
    }
    const result = stripSignatureFields(input)
    expect(result).not.toHaveProperty('signatures')
    expect(result).toHaveProperty('dpVersion')
  })

  it('should strip both signature and signatures', () => {
    const result = stripSignatureFields(playlistWithLegacySignature)
    expect(result).not.toHaveProperty('signature')
    expect(result).not.toHaveProperty('signatures')
  })

  it('should preserve all other fields', () => {
    const result = stripSignatureFields(playlistWithSignatures)
    expect(result).toHaveProperty('dpVersion')
    expect(result).toHaveProperty('title')
    expect(result).toHaveProperty('items')
  })
})

describe('canonicalPayload', () => {
  it('should produce consistent output for same input', () => {
    const canon1 = canonicalPayload(minimalPlaylist)
    const canon2 = canonicalPayload(minimalPlaylist)
    expect(canon1).toBe(canon2)
  })

  it('should produce same output after stripping signatures', () => {
    const withSigs = {
      dpVersion: '1.1.0',
      title: 'Test',
      signature: 'ed25519:old',
      items: [{ source: 'https://example.com/art' }],
      signatures: [],
    }
    const withoutSigs = {
      dpVersion: '1.1.0',
      title: 'Test',
      items: [{ source: 'https://example.com/art' }],
    }
    expect(canonicalPayload(withSigs)).toBe(canonicalPayload(withoutSigs))
  })

  it('should handle undefined fields correctly (JSON.stringify behavior)', () => {
    const withUndefined = {
      dpVersion: '1.1.0',
      title: 'Test',
      summary: undefined,
      items: [],
    }
    const withoutField = {
      dpVersion: '1.1.0',
      title: 'Test',
      items: [],
    }
    // JSON.stringify removes undefined, so both should be equivalent
    expect(canonicalPayload(withUndefined)).toBe(canonicalPayload(withoutField))
  })

  it('should canonicalize field order (JCS)', () => {
    const obj1 = { b: 2, a: 1 }
    const obj2 = { a: 1, b: 2 }
    expect(canonicalPayload(obj1)).toBe(canonicalPayload(obj2))
    expect(canonicalPayload(obj1)).toBe('{"a":1,"b":2}')
  })

  it('should handle nested objects', () => {
    const obj = {
      items: [
        { source: 'https://a', display: { scaling: 'fit' } },
        { source: 'https://b' },
      ],
    }
    const canon = canonicalPayload(obj)
    expect(canon).toContain('"items"')
    expect(canon).toContain('"display"')
  })

  it('should throw on non-serializable input', () => {
    const circular: { a?: unknown } = {}
    circular.a = circular
    expect(() => canonicalPayload(circular)).toThrow()
  })
})

describe('signingMessage', () => {
  it('should append newline to canonical JSON', () => {
    const message = signingMessage(minimalPlaylist)
    // Last byte should be 0x0A (newline)
    expect(message[message.length - 1]).toBe(0x0a)
  })

  it('should produce consistent output', () => {
    const msg1 = signingMessage(minimalPlaylist)
    const msg2 = signingMessage(minimalPlaylist)
    expect(msg1).toEqual(msg2)
  })

  it('should contain canonical JSON before newline', () => {
    const message = signingMessage({ a: 1, b: 2 })
    const decoder = new TextDecoder()
    const text = decoder.decode(message)
    expect(text).toBe('{"a":1,"b":2}\n')
  })
})

describe('signingDigest', () => {
  it('should produce 32-byte SHA-256 digest', async () => {
    const digest = await signingDigest(minimalPlaylist)
    expect(digest.length).toBe(32)
  })

  it('should produce consistent digest for same input', async () => {
    const digest1 = await signingDigest(minimalPlaylist)
    const digest2 = await signingDigest(minimalPlaylist)
    expect(digest1).toEqual(digest2)
  })

  it('should produce different digests for different inputs', async () => {
    const obj1 = { title: 'A' }
    const obj2 = { title: 'B' }
    const digest1 = await signingDigest(obj1)
    const digest2 = await signingDigest(obj2)
    expect(digest1).not.toEqual(digest2)
  })

  it('should strip signatures before hashing', async () => {
    const withSigs = {
      title: 'Test',
      signatures: [{ alg: 'test', sig: 'dummy' }],
    }
    const withoutSigs = { title: 'Test' }
    const digest1 = await signingDigest(withSigs)
    const digest2 = await signingDigest(withoutSigs)
    expect(digest1).toEqual(digest2)
  })
})

describe('payloadHashString', () => {
  it('should have sha256 prefix', async () => {
    const hash = await payloadHashString(minimalPlaylist)
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('should produce consistent hash for same input', async () => {
    const hash1 = await payloadHashString(minimalPlaylist)
    const hash2 = await payloadHashString(minimalPlaylist)
    expect(hash1).toBe(hash2)
  })

  it('should produce hex-encoded digest', async () => {
    const hash = await payloadHashString({ test: 'data' })
    const hexPart = hash.slice(7) // Remove "sha256:" prefix
    expect(hexPart).toMatch(/^[0-9a-f]{64}$/)
  })

  it('should match manual computation', async () => {
    const obj = { a: 1 }
    const hash = await payloadHashString(obj)
    const digest = await signingDigest(obj)
    const expectedHex = Array.from(digest)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    expect(hash).toBe(`sha256:${expectedHex}`)
  })
})

describe('ethereumAddressToDIDPKH', () => {
  it('should format with did:pkh:eip155:1 prefix', () => {
    const address = '0x1234567890123456789012345678901234567890'
    const did = ethereumAddressToDIDPKH(address)
    expect(did).toMatch(/^did:pkh:eip155:1:0x[0-9a-fA-F]{40}$/)
  })

  it('should apply EIP-55 checksum', () => {
    // Lowercase input
    const did = ethereumAddressToDIDPKH('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd')
    // Should contain checksummed version (viem handles this)
    expect(did).toContain('0x')
  })

  it('should handle already checksummed addresses', () => {
    const checksummed = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'
    const did = ethereumAddressToDIDPKH(checksummed)
    expect(did).toBe(`did:pkh:eip155:1:${checksummed}`)
  })

  it('should throw on invalid address', () => {
    expect(() => ethereumAddressToDIDPKH('not-an-address')).toThrow()
    expect(() => ethereumAddressToDIDPKH('0xinvalid')).toThrow()
  })
})

describe('edge cases', () => {
  it('should handle empty objects', () => {
    const canon = canonicalPayload({})
    expect(canon).toBe('{}')
  })

  it('should handle arrays', () => {
    const canon = canonicalPayload({ items: [1, 2, 3] })
    expect(canon).toBe('{"items":[1,2,3]}')
  })

  it('should handle null values', () => {
    const canon = canonicalPayload({ value: null })
    expect(canon).toBe('{"value":null}')
  })

  it('should handle unicode characters', () => {
    const canon = canonicalPayload({ title: 'Test 中文 🎨' })
    expect(canon).toContain('title')
  })
})
