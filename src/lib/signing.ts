/**
 * DP-1 Signing Implementation
 * Based on dp1-go/sign/payload.go and multisig.go
 */

import { getAddress, type WalletClient } from 'viem'
import canonicalize from 'canonicalize'
import type { Signature } from '@/types/dp1'

/**
 * Strip top-level "signature" and "signatures" fields from JSON
 * DP-1 §7.1: These fields must be removed before canonicalization
 */
export function stripSignatureFields(raw: object): object {
  const { signature, signatures, ...rest } = raw as {
    signature?: unknown
    signatures?: unknown
    [key: string]: unknown
  }
  void signature
  void signatures
  return rest
}

/**
 * Match the document shape after `JSON.stringify` (wire / server parse): omit `undefined`,
 * so JCS hashing aligns with what the feed verifies. In-memory objects from the UI often
 * still have optional fields set to `undefined`, which JSON drops and canonicalize may treat
 * differently from missing keys.
 */
function jsonPayloadStableForSigning(stripped: object): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(stripped)) as Record<string, unknown>
  } catch {
    throw new Error(
      'Document must be JSON-serializable for signing (avoid undefined in arrays, BigInt, or circular refs)'
    )
  }
}

/**
 * Canonicalize JSON using JCS (RFC 8785), matching dp1-go/jcs (gowebpki/jcs).
 */
export function canonicalPayload(raw: object): string {
  const stripped = stripSignatureFields(raw)
  const stable = jsonPayloadStableForSigning(stripped)
  const out = canonicalize(stable)
  if (out === undefined) {
    throw new Error('JCS canonicalization failed')
  }
  return out
}

/**
 * Construct signing message: canonical JSON + "\n"
 * DP-1 §7.1: The octets hashed for Ed25519/EIP-191
 */
export function signingMessage(raw: object): Uint8Array {
  const canon = canonicalPayload(raw)
  const encoder = new TextEncoder()
  const canonBytes = encoder.encode(canon)
  
  // Append line feed
  const message = new Uint8Array(canonBytes.length + 1)
  message.set(canonBytes)
  message[canonBytes.length] = 0x0A // '\n'
  
  return message
}

/**
 * Compute SHA-256 digest of signing message
 * Returns 32-byte digest (what gets signed)
 */
export async function signingDigest(raw: object): Promise<Uint8Array> {
  const message = signingMessage(raw)
  const hashBuffer = await crypto.subtle.digest('SHA-256', message)
  return new Uint8Array(hashBuffer)
}

/**
 * Compute payload_hash string for signature assertion
 * Format: "sha256:" + hex(digest)
 */
export async function payloadHashString(raw: object): Promise<string> {
  const digest = await signingDigest(raw)
  const hex = Array.from(digest)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  return `sha256:${hex}`
}

/**
 * Convert Ethereum address to DID:PKH format
 * Format: did:pkh:eip155:1:{checksummed-address}
 * Chain ID 1 = Ethereum mainnet
 */
export function ethereumAddressToDIDPKH(address: string): string {
  const checksummed = getAddress(address) // EIP-55 checksum
  return `did:pkh:eip155:1:${checksummed}`
}

/**
 * Sign a DP-1 document with EIP-191 personal message signing
 * 
 * @param raw - The unsigned document (will be canonicalized)
 * @param walletClient - viem WalletClient with account
 * @param role - Signature role ('curator' for playlists, 'publisher' for channels)
 * @returns Complete signature object ready for document's signatures array
 */
export async function signDocument(
  raw: object,
  walletClient: WalletClient,
  role: 'curator' | 'publisher'
): Promise<Signature> {
  if (!walletClient.account) {
    throw new Error('Wallet client must have an account')
  }

  const address = walletClient.account.address
  
  // 1. Compute digest (32 bytes to sign)
  const digest = await signingDigest(raw)
  
  // 2. Compute payload_hash for assertion field
  const payloadHash = await payloadHashString(raw)
  
  // 3. Sign digest using EIP-191 personal_sign
  // viem's signMessage will prepend "\x19Ethereum Signed Message:\n32"
  const signature = await walletClient.signMessage({
    account: walletClient.account,
    message: { raw: digest }
  })
  
  // 4. Convert signature to base64url (no padding)
  const sigBytes = hexToBytes(signature)
  const base64url = bytesToBase64Url(sigBytes)
  
  // 5. Construct DID:PKH kid
  const kid = ethereumAddressToDIDPKH(address)
  
  // 6. Current timestamp RFC3339
  const ts = new Date().toISOString()
  
  return {
    alg: 'eip191',
    kid,
    ts,
    payload_hash: payloadHash,
    role,
    sig: base64url
  }
}

/**
 * Convert hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  const cleaned = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(cleaned.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/**
 * Convert bytes to base64url (no padding)
 * RFC 4648 §5
 */
function bytesToBase64Url(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes))
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '') // Remove padding
}
