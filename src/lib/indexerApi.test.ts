import { describe, it, expect } from 'vitest'
import { buildArtBlocksVendorReleaseId } from '@/lib/indexerApi'

describe('buildArtBlocksVendorReleaseId', () => {
  it('lowercases contract address to match indexer storage', () => {
    expect(
      buildArtBlocksVendorReleaseId('0xBC4c0E659423DB6217a1A0aF0Acb7D3dD9eEc1', '42')
    ).toBe('1-0xbc4c0e659423db6217a1a0af0acb7d3dd9eec1-42')
  })

  it('trims contract and project id', () => {
    expect(buildArtBlocksVendorReleaseId('  0xabc  ', '  7  ')).toBe('1-0xabc-7')
  })
})
