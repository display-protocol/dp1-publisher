import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FeedAPIError, friendlyPublishError, validatePlaylistURI } from './api'

describe('validatePlaylistURI', () => {
  const originalEnv = { ...import.meta.env }

  beforeEach(() => {
    // Ensure production mode for most tests
    ;(import.meta.env as { DEV: boolean }).DEV = false
    delete (import.meta.env as Record<string, unknown>).VITE_DEBUG_MODE
  })

  afterEach(() => {
    // Restore original env
    ;(import.meta.env as { DEV: boolean }).DEV = originalEnv.DEV
    ;(import.meta.env as { VITE_DEBUG_MODE?: string }).VITE_DEBUG_MODE =
      originalEnv.VITE_DEBUG_MODE
  })

  describe('protocol validation (production)', () => {
    it('allows https://', () => {
      const result = validatePlaylistURI('https://example.com/playlist.json')
      expect(result.valid).toBe(true)
    })

    it('allows ipfs://', () => {
      const result = validatePlaylistURI('ipfs://QmExample123')
      expect(result.valid).toBe(true)
    })

    it('blocks http:// in production', () => {
      const result = validatePlaylistURI('http://example.com/playlist.json')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('https://')
    })

    it('blocks ftp://', () => {
      const result = validatePlaylistURI('ftp://example.com/file.json')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('https://')
    })

    it('blocks file://', () => {
      const result = validatePlaylistURI('file:///etc/passwd')
      expect(result.valid).toBe(false)
    })
  })

  describe('localhost blocking', () => {
    it('blocks localhost by name', () => {
      const result = validatePlaylistURI('https://localhost/playlist.json')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('Private/local')
    })

    it('blocks LOCALHOST (case insensitive)', () => {
      const result = validatePlaylistURI('https://LOCALHOST/playlist.json')
      expect(result.valid).toBe(false)
    })
  })

  describe('IPv4 loopback blocking (127.0.0.0/8)', () => {
    it('blocks 127.0.0.1', () => {
      const result = validatePlaylistURI('https://127.0.0.1/playlist.json')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('Private/local')
    })

    it('blocks 127.1.2.3', () => {
      const result = validatePlaylistURI('https://127.1.2.3/playlist.json')
      expect(result.valid).toBe(false)
    })

    it('blocks 127.255.255.255', () => {
      const result = validatePlaylistURI('https://127.255.255.255/playlist.json')
      expect(result.valid).toBe(false)
    })
  })

  describe('IPv4 private range blocking (RFC1918)', () => {
    // 10.0.0.0/8
    it('blocks 10.0.0.1', () => {
      const result = validatePlaylistURI('https://10.0.0.1/playlist.json')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('Private/local')
    })

    it('blocks 10.255.255.255', () => {
      const result = validatePlaylistURI('https://10.255.255.255/playlist.json')
      expect(result.valid).toBe(false)
    })

    // 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
    it('blocks 172.16.0.1', () => {
      const result = validatePlaylistURI('https://172.16.0.1/playlist.json')
      expect(result.valid).toBe(false)
    })

    it('blocks 172.17.0.1 (Docker default)', () => {
      const result = validatePlaylistURI('https://172.17.0.1/playlist.json')
      expect(result.valid).toBe(false)
    })

    it('blocks 172.31.255.255 (end of range)', () => {
      const result = validatePlaylistURI('https://172.31.255.255/playlist.json')
      expect(result.valid).toBe(false)
    })

    it('allows 172.15.255.255 (just before range)', () => {
      const result = validatePlaylistURI('https://172.15.255.255/playlist.json')
      expect(result.valid).toBe(true)
    })

    it('allows 172.32.0.0 (just after range)', () => {
      const result = validatePlaylistURI('https://172.32.0.0/playlist.json')
      expect(result.valid).toBe(true)
    })

    // CRITICAL: Verify fix for 172.2* false positive
    it('allows 172.200.0.1 (public IP, was incorrectly blocked)', () => {
      const result = validatePlaylistURI('https://172.200.0.1/playlist.json')
      expect(result.valid).toBe(true)
    })

    it('allows 172.201.1.1 (public IP)', () => {
      const result = validatePlaylistURI('https://172.201.1.1/playlist.json')
      expect(result.valid).toBe(true)
    })

    // 192.168.0.0/16
    it('blocks 192.168.0.1', () => {
      const result = validatePlaylistURI('https://192.168.0.1/playlist.json')
      expect(result.valid).toBe(false)
    })

    it('blocks 192.168.255.255', () => {
      const result = validatePlaylistURI('https://192.168.255.255/playlist.json')
      expect(result.valid).toBe(false)
    })

    it('allows 192.167.0.1 (public)', () => {
      const result = validatePlaylistURI('https://192.167.0.1/playlist.json')
      expect(result.valid).toBe(true)
    })

    it('allows 192.169.0.1 (public)', () => {
      const result = validatePlaylistURI('https://192.169.0.1/playlist.json')
      expect(result.valid).toBe(true)
    })
  })

  describe('IPv4 link-local blocking (169.254.0.0/16)', () => {
    it('blocks 169.254.0.1', () => {
      const result = validatePlaylistURI('https://169.254.0.1/playlist.json')
      expect(result.valid).toBe(false)
    })

    it('blocks 169.254.169.254 (AWS metadata)', () => {
      const result = validatePlaylistURI('https://169.254.169.254/latest/meta-data/')
      expect(result.valid).toBe(false)
    })
  })

  describe('IPv4 current network blocking (0.0.0.0/8)', () => {
    it('blocks 0.0.0.0', () => {
      const result = validatePlaylistURI('https://0.0.0.0/playlist.json')
      expect(result.valid).toBe(false)
    })

    it('blocks 0.1.2.3', () => {
      const result = validatePlaylistURI('https://0.1.2.3/playlist.json')
      expect(result.valid).toBe(false)
    })
  })

  describe('IPv4 obfuscation attempts', () => {
    it('normalizes octal to decimal (0127 becomes 87)', () => {
      // Browser URL parser normalizes octal: 0127 (octal) = 87 (decimal)
      // Since 87.0.0.1 is a valid public IP, it should be allowed
      const result = validatePlaylistURI('https://0127.0.0.1/playlist.json')
      expect(result.valid).toBe(true) // Normalized to public IP
    })

    it('blocks octal-obfuscated loopback (0177.0.0.1 becomes 127.0.0.1)', () => {
      // Browser normalizes 0177 (octal) to 127 (decimal), which is loopback
      const result = validatePlaylistURI('https://0177.0.0.1/playlist.json')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('Private/local')
    })

    it('blocks octal-obfuscated private IP (0300.0250.1.1 becomes 192.168.1.1)', () => {
      // Browser normalizes 0300 (octal) = 192, 0250 (octal) = 168
      const result = validatePlaylistURI('https://0300.0250.1.1/playlist.json')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('Private/local')
    })

    it('allows single zero', () => {
      const result = validatePlaylistURI('https://192.0.2.1/playlist.json')
      expect(result.valid).toBe(true)
    })
  })

  describe('IPv6 blocking', () => {
    it('blocks ::1 (loopback)', () => {
      const result = validatePlaylistURI('https://[::1]/playlist.json')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('Private/local')
    })

    it('blocks 0:0:0:0:0:0:0:1 (loopback expanded)', () => {
      const result = validatePlaylistURI('https://[0:0:0:0:0:0:0:1]/playlist.json')
      expect(result.valid).toBe(false)
    })

    it('blocks :: (unspecified)', () => {
      const result = validatePlaylistURI('https://[::]/playlist.json')
      expect(result.valid).toBe(false)
    })

    it('blocks fe80:: (link-local)', () => {
      const result = validatePlaylistURI('https://[fe80::1]/playlist.json')
      expect(result.valid).toBe(false)
    })

    it('blocks fc00:: (unique local)', () => {
      const result = validatePlaylistURI('https://[fc00::1]/playlist.json')
      expect(result.valid).toBe(false)
    })

    it('blocks fd00:: (unique local)', () => {
      const result = validatePlaylistURI('https://[fd00::1]/playlist.json')
      expect(result.valid).toBe(false)
    })

    it('allows public IPv6', () => {
      const result = validatePlaylistURI('https://[2001:db8::1]/playlist.json')
      expect(result.valid).toBe(true)
    })

    it('blocks IPv4-mapped IPv6 with private IPv4 (::ffff:192.168.1.1)', () => {
      const result = validatePlaylistURI('https://[::ffff:192.168.1.1]/playlist.json')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('Private/local')
    })

    it('blocks IPv4-mapped IPv6 with loopback (::ffff:127.0.0.1)', () => {
      const result = validatePlaylistURI('https://[::ffff:127.0.0.1]/playlist.json')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('Private/local')
    })

    it('blocks IPv4-mapped IPv6 with private 10.x (::ffff:10.0.0.1)', () => {
      const result = validatePlaylistURI('https://[::ffff:10.0.0.1]/playlist.json')
      expect(result.valid).toBe(false)
    })

    it('allows IPv4-mapped IPv6 with public IPv4 (::ffff:8.8.8.8)', () => {
      const result = validatePlaylistURI('https://[::ffff:8.8.8.8]/playlist.json')
      expect(result.valid).toBe(true)
    })

    it('blocks IPv4-compatible IPv6 with private IPv4 (::192.168.1.1)', () => {
      // IPv4-compatible format (deprecated but still parsed): ::192.168.1.1 → ::c0a8:101
      const result = validatePlaylistURI('https://[::192.168.1.1]/playlist.json')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('Private/local')
    })

    it('blocks IPv4-compatible IPv6 with loopback (::127.0.0.1)', () => {
      const result = validatePlaylistURI('https://[::127.0.0.1]/playlist.json')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('Private/local')
    })

    it('blocks IPv4-compatible IPv6 with private 10.x (::10.0.0.1)', () => {
      const result = validatePlaylistURI('https://[::10.0.0.1]/playlist.json')
      expect(result.valid).toBe(false)
    })

    it('allows IPv4-compatible IPv6 with public IPv4 (::8.8.8.8)', () => {
      const result = validatePlaylistURI('https://[::8.8.8.8]/playlist.json')
      expect(result.valid).toBe(true)
    })

    it('allows public IPv6 with tail hextets resembling private IPv4 (2001:db8::c0a8:101)', () => {
      // Regression test: 2001:db8::c0a8:101 has tail hextets c0a8:101 (192.168.1.1 in hex)
      // but is NOT IPv4-compatible (doesn't start with ::), so should be allowed as normal public IPv6
      const result = validatePlaylistURI('https://[2001:db8::c0a8:101]/playlist.json')
      expect(result.valid).toBe(true)
    })
  })

  describe('valid public IPs and domains', () => {
    it('allows valid public IPv4', () => {
      const result = validatePlaylistURI('https://8.8.8.8/playlist.json')
      expect(result.valid).toBe(true)
    })

    it('allows valid domain names', () => {
      const result = validatePlaylistURI('https://example.com/playlist.json')
      expect(result.valid).toBe(true)
    })

    it('allows subdomains', () => {
      const result = validatePlaylistURI('https://cdn.example.com/playlist.json')
      expect(result.valid).toBe(true)
    })

    it('allows domains with hyphens', () => {
      const result = validatePlaylistURI('https://my-domain.example.com/playlist.json')
      expect(result.valid).toBe(true)
    })
  })

  describe('invalid URI format', () => {
    it('rejects malformed URIs', () => {
      const result = validatePlaylistURI('not-a-uri')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('Invalid URI')
    })

    it('rejects empty string', () => {
      const result = validatePlaylistURI('')
      expect(result.valid).toBe(false)
    })

    it('rejects URI with no hostname', () => {
      const result = validatePlaylistURI('https://')
      expect(result.valid).toBe(false)
    })
  })

  describe('debug mode', () => {
    it('allows http:// in debug mode', () => {
      ;(import.meta.env as { DEV: boolean }).DEV = true
      ;(import.meta.env as { VITE_DEBUG_MODE?: string }).VITE_DEBUG_MODE = 'true'

      const result = validatePlaylistURI('http://localhost:3000/playlist.json')
      expect(result.valid).toBe(true)
    })

    it('does not allow http:// when DEV is false', () => {
      ;(import.meta.env as { DEV: boolean }).DEV = false
      ;(import.meta.env as { VITE_DEBUG_MODE?: string }).VITE_DEBUG_MODE = 'true'

      const result = validatePlaylistURI('http://localhost:3000/playlist.json')
      expect(result.valid).toBe(false)
    })

    it('does not allow http:// when VITE_DEBUG_MODE is not true', () => {
      ;(import.meta.env as { DEV: boolean }).DEV = true
      ;(import.meta.env as { VITE_DEBUG_MODE?: string }).VITE_DEBUG_MODE = 'false'

      const result = validatePlaylistURI('http://localhost:3000/playlist.json')
      expect(result.valid).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('handles URLs with ports', () => {
      const result = validatePlaylistURI('https://example.com:8080/playlist.json')
      expect(result.valid).toBe(true)
    })

    it('handles URLs with query params', () => {
      const result = validatePlaylistURI('https://example.com/playlist.json?v=1')
      expect(result.valid).toBe(true)
    })

    it('handles URLs with fragments', () => {
      const result = validatePlaylistURI('https://example.com/playlist.json#section')
      expect(result.valid).toBe(true)
    })

    it('blocks private IP with port', () => {
      const result = validatePlaylistURI('https://192.168.1.1:8080/playlist.json')
      expect(result.valid).toBe(false)
    })

    it('handles uppercase domain (normalized to lowercase)', () => {
      const result = validatePlaylistURI('https://EXAMPLE.COM/playlist.json')
      expect(result.valid).toBe(true)
    })
  })
})

describe('friendlyPublishError', () => {
  describe('wrong wallet', () => {
    it('uses overwrite-specific copy on update intent (401)', () => {
      const err = new FeedAPIError('signature rejected', 401, 'unauthorized')
      const msg = friendlyPublishError(err, 'playlist', 'update')
      expect(msg).toMatch(/different wallet/i)
      expect(msg).toMatch(/connect that wallet/i)
    })

    it('uses create-specific copy on create intent (401)', () => {
      const err = new FeedAPIError('signature rejected', 401, 'unauthorized')
      const msg = friendlyPublishError(err, 'playlist', 'create')
      expect(msg).toMatch(/signing failed/i)
      expect(msg).not.toMatch(/different wallet/i)
    })

    it('points at the curator field for playlists on create-mode failures', () => {
      const err = new FeedAPIError('signature rejected', 401, 'unauthorized')
      const msg = friendlyPublishError(err, 'playlist', 'create')
      expect(msg).toMatch(/curator/i)
      expect(msg).not.toMatch(/publisher/i)
    })

    it('points at the curator field for playlist groups on create-mode failures', () => {
      const err = new FeedAPIError('signature rejected', 401, 'unauthorized')
      const msg = friendlyPublishError(err, 'playlist-group', 'create')
      expect(msg).toMatch(/curator/i)
      expect(msg).not.toMatch(/publisher/i)
    })

    it('points at the publisher field for channels on create-mode failures', () => {
      const err = new FeedAPIError('signature rejected', 401, 'unauthorized')
      const msg = friendlyPublishError(err, 'channel', 'create')
      expect(msg).toMatch(/publisher/i)
      expect(msg).not.toMatch(/curator/i)
    })

    it('treats "signature" in message body as auth failure regardless of status', () => {
      const err = new FeedAPIError('invalid signature for payload', 400, 'bad_request')
      expect(friendlyPublishError(err, 'channel', 'update')).toMatch(/different wallet/i)
    })
  })

  describe('duplicate-key collisions', () => {
    it('produces id-specific copy when slug is not mentioned', () => {
      const err = new FeedAPIError(
        'duplicate key value violates unique constraint "playlists_pkey"',
        409,
        'conflict'
      )
      const msg = friendlyPublishError(err, 'playlist', 'create')
      expect(msg).toMatch(/with this id already exists/i)
      expect(msg).toMatch(/upload again to overwrite/i)
      expect(msg).not.toMatch(/choose a different slug/i)
    })

    it('produces slug-specific copy when the constraint name mentions slug', () => {
      const err = new FeedAPIError(
        'duplicate key value violates unique constraint "channels_slug_key"',
        409,
        'conflict'
      )
      const msg = friendlyPublishError(err, 'channel', 'create')
      expect(msg).toMatch(/with this slug already exists/i)
      expect(msg).toMatch(/choose a different slug/i)
      expect(msg).not.toMatch(/upload again to overwrite/i)
    })

    it('catches Postgres SQLSTATE 23505 as duplicate-key', () => {
      const err = new FeedAPIError(
        'store: insert playlist: SQLSTATE 23505: duplicate value',
        500,
        'db_error'
      )
      const msg = friendlyPublishError(err, 'playlist-group', 'create')
      expect(msg).toMatch(/with this id already exists/i)
    })
  })

  describe('404 on update', () => {
    it('explains the document is no longer on the feed', () => {
      const err = new FeedAPIError('not found', 404, 'not_found')
      expect(friendlyPublishError(err, 'playlist', 'update')).toMatch(/no longer on the feed/i)
    })
  })

  describe('store-prefix stripping', () => {
    it('strips the "store: insert …" Postgres prefix from generic errors', () => {
      const err = new FeedAPIError('store: insert playlist: weird db hiccup', 500, 'db_error')
      const msg = friendlyPublishError(err, 'playlist', 'create')
      expect(msg).not.toMatch(/^store:/i)
      expect(msg).toMatch(/weird db hiccup/i)
    })
  })
})
