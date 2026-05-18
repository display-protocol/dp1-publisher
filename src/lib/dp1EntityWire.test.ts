/**
 * Tests for entity wire format
 * Ensures correct omitempty behavior matching dp1-go
 */

import { describe, it, expect } from 'vitest'
import { entityWire } from '@/lib/dp1EntityWire'
import type { Entity } from '@/types/dp1'

describe('entityWire', () => {
  it('should always include name and key fields', () => {
    const entity: Entity = {
      name: 'Test',
      key: 'testkey',
    }
    const result = entityWire(entity)
    expect(result).toHaveProperty('name', 'Test')
    expect(result).toHaveProperty('key', 'testkey')
  })

  it('should include url when present and non-empty', () => {
    const entity: Entity = {
      name: 'Test',
      key: 'testkey',
      url: 'https://example.com',
    }
    const result = entityWire(entity)
    expect(result.url).toBe('https://example.com')
  })

  it('should omit url when empty string', () => {
    const entity: Entity = {
      name: 'Test',
      key: 'testkey',
      url: '',
    }
    const result = entityWire(entity)
    expect(result).not.toHaveProperty('url')
  })

  it('should omit url when only whitespace', () => {
    const entity: Entity = {
      name: 'Test',
      key: 'testkey',
      url: '   ',
    }
    const result = entityWire(entity)
    expect(result).not.toHaveProperty('url')
  })

  it('should omit url when undefined', () => {
    const entity: Entity = {
      name: 'Test',
      key: 'testkey',
    }
    const result = entityWire(entity)
    expect(result).not.toHaveProperty('url')
  })

  it('should preserve empty name and key (not omit)', () => {
    const entity: Entity = {
      name: '',
      key: '',
    }
    const result = entityWire(entity)
    expect(result).toHaveProperty('name', '')
    expect(result).toHaveProperty('key', '')
    expect(result).not.toHaveProperty('url')
  })

  it('should trim url whitespace', () => {
    const entity: Entity = {
      name: 'Test',
      key: 'testkey',
      url: '  https://example.com  ',
    }
    const result = entityWire(entity)
    expect(result.url).toBe('https://example.com')
  })

  it('should handle DID keys', () => {
    const entity: Entity = {
      name: 'Alice',
      key: 'did:pkh:eip155:1:0x1234567890123456789012345678901234567890',
      url: 'https://alice.example.com',
    }
    const result = entityWire(entity)
    expect(result.name).toBe('Alice')
    expect(result.key).toBe('did:pkh:eip155:1:0x1234567890123456789012345678901234567890')
    expect(result.url).toBe('https://alice.example.com')
  })
})
