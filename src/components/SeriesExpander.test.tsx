/**
 * SeriesExpander tests. The vendor boundary (`loadVendorRelease`) is stubbed; vendor
 * request shapes are covered in src/lib/vendors/*.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import SeriesExpander from './SeriesExpander'
import * as vendors from '@/lib/vendors'
import type { VendorLoadResult, VendorToken } from '@/lib/vendors'

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: '0x0000000000000000000000000000000000000001' }),
  useWalletClient: () => ({
    data: { account: { address: '0x0000000000000000000000000000000000000001' } },
  }),
}))

const toastMock = vi.fn()
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}))

function makeToken(mintNumber: number, overrides: Partial<VendorToken> = {}): VendorToken {
  return {
    vendor: 'feralfile',
    mintNumber,
    chain: 'evm',
    standard: 'erc721',
    contractAddress: '0xD1b52beE57FB7e31Ed50122cC1eeb6a4673D9Eae',
    tokenId: String(1000 + mintNumber),
    title: `Work ${mintNumber}`,
    source: `https://cdn.artworks.feralfile.io/previews/s/${mintNumber}.jpg`,
    ...overrides,
  }
}

function result(
  tokens: VendorToken[],
  overrides: Partial<VendorLoadResult> = {},
  totalMints: number | null = tokens.length
): VendorLoadResult {
  return {
    release: { vendor: 'feralfile', slug: 'my-series', name: 'My Series', totalMints },
    tokens,
    wasCapped: false,
    uncheckedMints: [],
    ...overrides,
  }
}

function load(slug = 'my-series', mints?: string) {
  fireEvent.change(screen.getByLabelText('Series slug'), { target: { value: slug } })
  if (mints) {
    fireEvent.change(screen.getByLabelText(/Mint numbers/i), { target: { value: mints } })
  }
  fireEvent.click(screen.getByRole('button', { name: 'Load series' }))
}

describe('SeriesExpander', () => {
  beforeEach(() => toastMock.mockClear())
  afterEach(() => vi.restoreAllMocks())

  it('passes vendor, slug and parsed mint spec to the vendor loader', async () => {
    const spy = vi.spyOn(vendors, 'loadVendorRelease').mockResolvedValue(result([makeToken(1)]))
    render(<SeriesExpander currentItemCount={0} onAdd={vi.fn()} />)
    load('my-series', '1..3')
    await waitFor(() => expect(spy).toHaveBeenCalledWith('feralfile', 'my-series', [1, 2, 3]))
  })

  it('shows a client-limit warning and "Load first N items" when the load is capped', async () => {
    const tokens = Array.from({ length: 5 }, (_, i) => makeToken(i + 1))
    vi.spyOn(vendors, 'loadVendorRelease').mockResolvedValue(
      result(tokens, { wasCapped: true }, 5000)
    )
    render(<SeriesExpander currentItemCount={0} onAdd={vi.fn()} />)
    load()
    await waitFor(() => expect(screen.getByText(/client limit/i)).toBeInTheDocument())
    expect(
      screen.getByRole('button', { name: /load first 5 items into playlist/i })
    ).toBeInTheDocument()
  })

  it('shows a plain load button and no cap warning when not capped', async () => {
    vi.spyOn(vendors, 'loadVendorRelease').mockResolvedValue(result([makeToken(1), makeToken(2)]))
    render(<SeriesExpander currentItemCount={0} onAdd={vi.fn()} />)
    load()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^load 2 items into playlist$/i })).toBeInTheDocument()
    )
    expect(screen.queryByText(/client limit/i)).not.toBeInTheDocument()
  })

  it('reports requested mints the vendor did not return, with no indexing action', async () => {
    vi.spyOn(vendors, 'loadVendorRelease').mockResolvedValue(result([makeToken(1), makeToken(2)]))
    render(<SeriesExpander currentItemCount={0} onAdd={vi.fn()} />)
    load('my-series', '1..4')
    await waitFor(() =>
      expect(
        screen.getByText(/2 requested mints not found on Feral File \(mints: 3, 4\)/)
      ).toBeInTheDocument()
    )
    expect(screen.queryByRole('button', { name: /index/i })).not.toBeInTheDocument()
  })

  it('lists unchecked mints separately and never as "not found"', async () => {
    vi.spyOn(vendors, 'loadVendorRelease').mockResolvedValue(
      result([makeToken(1)], { uncheckedMints: [3] })
    )
    render(<SeriesExpander currentItemCount={0} onAdd={vi.fn()} />)
    load('my-series', '1,2,3')
    await waitFor(() =>
      expect(screen.getByText(/1 requested mint was not checked \(request limit; mints: 3\)/)).toBeInTheDocument()
    )
    expect(screen.getByText(/1 requested mint not found on Feral File \(mints: 2\)/)).toBeInTheDocument()
  })

  it('shows a generic message for errors that are not from a vendor', async () => {
    vi.spyOn(vendors, 'loadVendorRelease').mockRejectedValue(new TypeError('x.map is not a function'))
    render(<SeriesExpander currentItemCount={0} onAdd={vi.fn()} />)
    load()
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Failed to load release.'))
  })

  it('renders a vendor error message as an alert', async () => {
    vi.spyOn(vendors, 'loadVendorRelease').mockRejectedValue(
      new vendors.VendorAPIError('No Feral File series with slug "nope".', 'feralfile', 'not_found')
    )
    render(<SeriesExpander currentItemCount={0} onAdd={vi.fn()} />)
    load('nope')
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('No Feral File series with slug "nope".')
    )
  })

  it('skips moderated tokens and hands only addable items to onAdd', async () => {
    vi.spyOn(vendors, 'loadVendorRelease').mockResolvedValue(
      result([makeToken(1), makeToken(2, { excluded: 'moderated' })])
    )
    const onAdd = vi.fn()
    render(<SeriesExpander currentItemCount={0} onAdd={onAdd} />)
    load()
    await waitFor(() =>
      expect(screen.getByText(/1 token will be skipped \(1 taken down on Feral File\)/)).toBeInTheDocument()
    )
    fireEvent.click(screen.getByRole('button', { name: /^load 1 item into playlist$/i }))
    expect(onAdd).toHaveBeenCalledTimes(1)
    const [items, name] = onAdd.mock.calls[0]
    expect(items).toHaveLength(1)
    expect(items[0].provenance.contract.tokenId).toBe('1001')
    expect(name).toBe('My Series')
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Playlist replaced' }))
  })

  it('asks for confirmation before replacing existing items', async () => {
    vi.spyOn(vendors, 'loadVendorRelease').mockResolvedValue(result([makeToken(1)]))
    const onAdd = vi.fn()
    render(<SeriesExpander currentItemCount={3} onAdd={onAdd} />)
    load()
    const addButton = await screen.findByRole('button', { name: /^load 1 item into playlist$/i })
    fireEvent.click(addButton)
    expect(onAdd).not.toHaveBeenCalled()
    expect(screen.getByText(/replace the 3 existing items/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, replace with 1 item' }))
    expect(onAdd).toHaveBeenCalledTimes(1)
  })

  it('clears the preview when the slug changes after a load', async () => {
    vi.spyOn(vendors, 'loadVendorRelease').mockResolvedValue(result([makeToken(1)]))
    render(<SeriesExpander currentItemCount={0} onAdd={vi.fn()} />)
    load('first')
    await waitFor(() => expect(screen.getByText('My Series')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Series slug'), { target: { value: 'second' } })
    expect(screen.queryByText('My Series')).not.toBeInTheDocument()
  })

  it('labels the slug input per vendor', () => {
    render(<SeriesExpander currentItemCount={0} onAdd={vi.fn()} />)
    expect(screen.getByLabelText('Series slug')).toHaveAttribute('placeholder', 'my-series-title')
  })
})
