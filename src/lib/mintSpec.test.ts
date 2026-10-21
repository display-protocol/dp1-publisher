import { describe, it, expect } from 'vitest'
import { MintSpecParseError, parseMintSpec } from '@/lib/mintSpec'

describe('parseMintSpec', () => {
  it('returns null for empty string', () => {
    expect(parseMintSpec('')).toBeNull()
  })

  it('returns null for whitespace-only string', () => {
    expect(parseMintSpec('  ')).toBeNull()
  })

  it('parses a single number', () => {
    expect(parseMintSpec('50')).toEqual([50])
  })

  it('parses a range into a sorted array', () => {
    expect(parseMintSpec('1..5')).toEqual([1, 2, 3, 4, 5])
  })

  it('parses a range with a single element', () => {
    expect(parseMintSpec('7..7')).toEqual([7])
  })

  it('parses a comma-separated list', () => {
    expect(parseMintSpec('1,3,5')).toEqual([1, 3, 5])
  })

  it('sorts a comma-separated list', () => {
    expect(parseMintSpec('5,1,3')).toEqual([1, 3, 5])
  })

  it('trims whitespace around comma-separated values', () => {
    expect(parseMintSpec(' 2 , 4 ')).toEqual([2, 4])
  })

  it('throws MintSpecParseError for a zero mint number', () => {
    expect(() => parseMintSpec('0')).toThrow(MintSpecParseError)
  })

  it('throws MintSpecParseError for a negative mint number', () => {
    expect(() => parseMintSpec('-1')).toThrow(MintSpecParseError)
  })

  it('throws MintSpecParseError for a reversed range', () => {
    expect(() => parseMintSpec('5..1')).toThrow(MintSpecParseError)
  })

  it('throws MintSpecParseError for a range starting at zero', () => {
    expect(() => parseMintSpec('0..5')).toThrow(MintSpecParseError)
  })

  it('throws MintSpecParseError for non-numeric input', () => {
    expect(() => parseMintSpec('abc')).toThrow(MintSpecParseError)
  })

  it('throws MintSpecParseError for a range that exceeds MINT_SPEC_MAX_SIZE', () => {
    // 1..1001 = 1001 entries, over the 1000 limit
    expect(() => parseMintSpec('1..1001')).toThrow(MintSpecParseError)
  })

  it('accepts a range exactly at MINT_SPEC_MAX_SIZE', () => {
    const result = parseMintSpec('1..1000')
    expect(result).toHaveLength(1000)
    expect(result![0]).toBe(1)
    expect(result![999]).toBe(1000)
  })

  it('throws MintSpecParseError for an explicit list that exceeds MINT_SPEC_MAX_SIZE', () => {
    // Explicit comma-separated lists must be capped identically to ranges so that
    // large pastes cannot fan out into hundreds of vendor requests.
    const overLimit = Array.from({ length: 1001 }, (_, i) => i + 1).join(',')
    expect(() => parseMintSpec(overLimit)).toThrow(MintSpecParseError)
  })

  it('accepts an explicit list exactly at MINT_SPEC_MAX_SIZE', () => {
    const atLimit = Array.from({ length: 1000 }, (_, i) => i + 1).join(',')
    const result = parseMintSpec(atLimit)
    expect(result).toHaveLength(1000)
  })

  it('throws MintSpecParseError for duplicate comma values', () => {
    expect(() => parseMintSpec('1,2,2')).toThrow(MintSpecParseError)
  })

  it('throws MintSpecParseError for malformed range with extra dots', () => {
    expect(() => parseMintSpec('1..2..3')).toThrow(MintSpecParseError)
  })
})
