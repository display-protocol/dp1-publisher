import { describe, it, expect } from 'vitest'
import { MAX_JSON_FILE_BYTES, validateJsonFile } from '@/lib/jsonFileValidation'

function makeFile(name: string, type: string, size = 64): File {
  // happy-dom's File constructor honors size from the parts; pad with spaces
  // when a specific size is requested.
  const parts = size > 0 ? [new Array(size + 1).join('a')] : ['']
  return new File(parts, name, { type })
}

describe('validateJsonFile', () => {
  it('accepts a .json file with application/json MIME', () => {
    expect(validateJsonFile(makeFile('playlist.json', 'application/json'))).toEqual({
      ok: true,
    })
  })

  it('accepts a .json file with empty MIME (some drop sources omit it)', () => {
    expect(validateJsonFile(makeFile('playlist.json', ''))).toEqual({ ok: true })
  })

  it('accepts a .JSON file (case-insensitive extension)', () => {
    expect(validateJsonFile(makeFile('PLAYLIST.JSON', 'application/json'))).toEqual({
      ok: true,
    })
  })

  it('accepts a file with json MIME but no .json extension', () => {
    expect(validateJsonFile(makeFile('payload', 'application/json'))).toEqual({
      ok: true,
    })
  })

  it('accepts text/plain (.json on the filename is the deciding signal)', () => {
    expect(validateJsonFile(makeFile('playlist.json', 'text/plain'))).toEqual({
      ok: true,
    })
  })

  it('rejects an obvious non-JSON file (image)', () => {
    const r = validateJsonFile(makeFile('cover.png', 'image/png'))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/\.json/i)
  })

  it('rejects a binary file with no name extension and no JSON-ish MIME', () => {
    const r = validateJsonFile(makeFile('binary', 'application/octet-stream'))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/\.json/i)
  })

  it('rejects a non-.json file with text/plain MIME (regression: notes.txt sneaking through)', () => {
    const r = validateJsonFile(makeFile('notes.txt', 'text/plain'))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/\.json/i)
  })

  it('rejects an extension-less file with empty MIME (regression: ambiguous drops)', () => {
    const r = validateJsonFile(makeFile('payload', ''))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/\.json/i)
  })

  it('rejects a file over the size cap', () => {
    const huge = makeFile('big.json', 'application/json', MAX_JSON_FILE_BYTES + 1)
    const r = validateJsonFile(huge)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/MB/)
  })

  it('accepts a file exactly at the cap', () => {
    const right = makeFile('exact.json', 'application/json', MAX_JSON_FILE_BYTES)
    expect(validateJsonFile(right).ok).toBe(true)
  })
})
