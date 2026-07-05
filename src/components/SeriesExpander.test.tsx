/**
 * Focused SeriesExpander tests covering the client-side MINT_SPEC_MAX_SIZE cap.
 *
 * When fetchTokensByVendorSlug returns wasCapped:true, the UI must:
 *   1. Show a "Showing the first N tokens (client limit…)" warning rather than
 *      the server-side partial-indexing warning.
 *   2. Label the add button "Load first N items into playlist" so curators know
 *      they are adding a deliberately truncated set.
 *
 * These tests guard against the regression where a capped load looks identical
 * to a complete load, silently producing a truncated DP-1 playlist.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import SeriesExpander from './SeriesExpander'
import * as indexerApi from '@/lib/indexerApi'

// wagmi: provide a stable connected wallet (no signing needed for load tests).
vi.mock('wagmi', () => ({
  useAccount: () => ({ address: '0x0000000000000000000000000000000000000001' }),
  useWalletClient: () => ({
    data: { account: { address: '0x0000000000000000000000000000000000000001' } },
  }),
}))

// Toast: capture calls so tests can assert on them if needed.
const toastMock = vi.fn()
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}))

function makeToken(id: number, mintNumber: number): indexerApi.IndexerToken {
  return {
    id,
    chain: 'ethereum',
    standard: 'erc721',
    contract_address: '0x0000000000000000000000000000000000000000',
    token_number: String(mintNumber),
    release_id: 1,
    mint_number: mintNumber,
    display: null,
    metadata: null,
  }
}

describe('SeriesExpander — client-side cap (wasCapped)', () => {
  beforeEach(() => { toastMock.mockClear() })
  afterEach(() => { vi.restoreAllMocks() })

  it('shows a client-limit warning and "Load first N items" button when load is capped', async () => {
    const cappedTokens = Array.from(
      { length: indexerApi.MINT_SPEC_MAX_SIZE },
      (_, i) => makeToken(i + 1, i + 1)
    )
    vi.spyOn(indexerApi, 'resolveReleaseBySlug').mockResolvedValue({
      id: 42,
      vendor: 'feralfile',
      vendor_release_id: 'big-series',
      vendor_release_slug: 'big-series',
      name: 'Big Series',
      total_mints: 5000,
    })
    vi.spyOn(indexerApi, 'fetchTokensByVendorSlug').mockResolvedValue({
      tokens: cappedTokens,
      wasCapped: true,
    })

    render(<SeriesExpander currentItemCount={0} onAdd={vi.fn()} />)

    // Enter slug and click Load series.
    fireEvent.change(screen.getByLabelText('Release slug'), {
      target: { value: 'big-series' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Load series' }))

    // The client-limit warning must appear.
    await waitFor(() => {
      expect(screen.getByText(/client limit/i)).toBeInTheDocument()
    })
    // The warning must NOT say "may not be indexed yet" (that's the server-side message).
    expect(screen.queryByText(/may not be indexed yet/i)).not.toBeInTheDocument()

    // The load button must explicitly say "first" to signal a truncated set.
    expect(
      screen.getByRole('button', { name: /load first \d+ items? into playlist/i })
    ).toBeInTheDocument()
  })

  it('shows standard partial-indexing warning (not cap warning) when wasCapped is false', async () => {
    const tokens = [makeToken(1, 1), makeToken(2, 2)]
    vi.spyOn(indexerApi, 'resolveReleaseBySlug').mockResolvedValue({
      id: 1,
      vendor: 'feralfile',
      vendor_release_id: 'small-series',
      vendor_release_slug: 'small-series',
      name: 'Small Series',
      total_mints: 10,
    })
    vi.spyOn(indexerApi, 'fetchTokensByVendorSlug').mockResolvedValue({
      tokens,
      wasCapped: false,
    })

    render(<SeriesExpander currentItemCount={0} onAdd={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Release slug'), {
      target: { value: 'small-series' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Load series' }))

    // Server-side partial-indexing warning should appear (2 of 10 indexed).
    await waitFor(() => {
      expect(screen.getByText(/may not be indexed yet/i)).toBeInTheDocument()
    })
    // Client-limit warning must NOT appear.
    expect(screen.queryByText(/client limit/i)).not.toBeInTheDocument()

    // Standard load button (no "first" prefix).
    expect(
      screen.getByRole('button', { name: /^load \d+ items? into playlist$/i })
    ).toBeInTheDocument()
  })
})
