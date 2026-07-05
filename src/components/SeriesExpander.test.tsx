/**
 * Focused SeriesExpander tests.
 *
 * Cap tests: when fetchTokensByVendorSlug returns wasCapped:true the UI must
 * show a distinct "client limit" warning and an explicit "Load first N items"
 * button label.
 *
 * Async indexing tests: cover the SeriesExpander indexing state machine using
 * vi.useFakeTimers() + vi.advanceTimersByTimeAsync() to drive Phase 1 / Phase 2
 * polling without real delays. At minimum:
 *   - successful single-batch indexing path reaches the success toast
 *   - partial-batch submission scopes Phase 2 to submittedMints only, completing
 *     when those tokens appear rather than waiting the full timeout for unsubmitted
 *     mints that can never appear
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

// ---------------------------------------------------------------------------
// Async indexing state machine (fake-timer tests)
// ---------------------------------------------------------------------------

// Phase poll intervals (mirror constants in SeriesExpander.tsx, not exported).
const PHASE1_POLL_MS = 3000
const PHASE2_POLL_MS = 5000

function makeJobStatus(jobId: number): indexerApi.IndexerJobStatus {
  return { job_id: jobId, status: 'succeeded', last_error: null, execution_time_ms: null }
}

/**
 * Load the series panel with a gap and return the "Index missing tokens" button.
 * Assumes resolveReleaseBySlug and fetchTokensByVendorSlug are already spied on.
 */
async function loadWithGap(slug: string) {
  fireEvent.change(screen.getByLabelText('Release slug'), { target: { value: slug } })
  fireEvent.change(screen.getByLabelText(/Mint numbers/i), { target: { value: '1,2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Load series' }))
  // Wait for loaded state: gap section appears.
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Index missing tokens' })).toBeInTheDocument()
  )
}

describe('SeriesExpander — async indexing state machine', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    toastMock.mockClear()
  })

  it('successful indexing: Phase 1 succeeds → Phase 2 tokens appear → success toast', async () => {
    const token1 = makeToken(1, 1)
    const token2 = makeToken(2, 2)

    vi.spyOn(indexerApi, 'resolveReleaseBySlug').mockResolvedValue({
      id: 1,
      vendor: 'feralfile',
      vendor_release_id: 'my-series',
      vendor_release_slug: 'my-series',
      name: 'My Series',
      total_mints: 2,
    })
    vi.spyOn(indexerApi, 'fetchTokensByVendorSlug')
      .mockResolvedValueOnce({ tokens: [token1], wasCapped: false }) // initial load: gap = mint 2
      .mockResolvedValue({ tokens: [token1, token2], wasCapped: false }) // Phase 2 + final refresh

    vi.spyOn(indexerApi, 'triggerReleaseIndexingBatched').mockResolvedValue({
      jobIds: [99],
      submittedMints: [2],
      partialError: null,
    })
    vi.spyOn(indexerApi, 'fetchJobStatus').mockResolvedValue(makeJobStatus(99))

    render(<SeriesExpander currentItemCount={0} onAdd={vi.fn()} />)

    // Load phase: use real timers so waitFor works normally.
    await loadWithGap('my-series')

    // Switch to fake timers only for the polling phase.
    vi.useFakeTimers()

    fireEvent.click(screen.getByRole('button', { name: 'Index missing tokens' }))

    // Advance through Phase 1 sleep + job status poll.
    await vi.advanceTimersByTimeAsync(PHASE1_POLL_MS + 100)

    // Advance through Phase 2 sleep + token appearance poll.
    await vi.advanceTimersByTimeAsync(PHASE2_POLL_MS + 100)

    // Flush remaining microtasks (final refresh, state updates).
    await vi.runAllTimersAsync()

    // Restore real timers so waitFor can poll normally.
    vi.useRealTimers()

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Tokens indexed' })
      )
    })

    // No failure/alert should be present.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  }, 15000)

  it('partial batch: Phase 2 polls submittedMints only and completes without timeout', async () => {
    // 51 gap mints: batch 1 ([1..50]) succeeds, batch 2 ([51]) fails.
    // Without the fix, Phase 2 would poll all 51 mints and time out because
    // mint 51 was never submitted. With the fix, Phase 2 polls submittedMints
    // ([1..50]) only and completes when those 50 tokens appear.
    const totalGapMints = indexerApi.MINT_NUMBERS_BATCH_SIZE + 1  // 51
    const submittedMintNumbers = Array.from({ length: indexerApi.MINT_NUMBERS_BATCH_SIZE }, (_, i) => i + 1)

    vi.spyOn(indexerApi, 'resolveReleaseBySlug').mockResolvedValue({
      id: 2,
      vendor: 'feralfile',
      vendor_release_id: 'big-series',
      vendor_release_slug: 'big-series',
      name: 'Big Series',
      total_mints: totalGapMints,
    })

    // Initial load with mint spec: returns 0 tokens → all 51 are gaps.
    // Phase 2 poll: 50 submittedMints tokens appear. Final refresh: same.
    const submittedTokens = submittedMintNumbers.map((n) => makeToken(n, n))
    vi.spyOn(indexerApi, 'fetchTokensByVendorSlug')
      .mockResolvedValueOnce({ tokens: [], wasCapped: false }) // initial load
      .mockResolvedValue({ tokens: submittedTokens, wasCapped: false }) // Phase 2 + final refresh

    vi.spyOn(indexerApi, 'triggerReleaseIndexingBatched').mockResolvedValue({
      jobIds: [42],
      submittedMints: submittedMintNumbers,
      partialError: 'Batch 2 failed (503)',
    })
    vi.spyOn(indexerApi, 'fetchJobStatus').mockResolvedValue(makeJobStatus(42))

    render(<SeriesExpander currentItemCount={0} onAdd={vi.fn()} />)

    // Load with a mint spec spanning all 51 gap mints so "Index missing tokens" appears.
    // "1..51" parses to [1..51]; the mock returns 0 tokens so all 51 become gaps.
    fireEvent.change(screen.getByLabelText('Release slug'), { target: { value: 'big-series' } })
    fireEvent.change(screen.getByLabelText(/Mint numbers/i), {
      target: { value: `1..${totalGapMints}` },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Load series' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Index missing tokens' })).toBeInTheDocument()
    )

    // Switch to fake timers for the polling phase.
    vi.useFakeTimers()

    fireEvent.click(screen.getByRole('button', { name: 'Index missing tokens' }))

    // Advance Phase 1.
    await vi.advanceTimersByTimeAsync(PHASE1_POLL_MS + 100)

    // Advance Phase 2: submittedMints tokens all appear in one poll, completing Phase 2.
    await vi.advanceTimersByTimeAsync(PHASE2_POLL_MS + 100)

    // Flush remaining microtasks.
    await vi.runAllTimersAsync()

    vi.useRealTimers()

    // Phase 2 must complete (not timeout) because submittedMints appeared.
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Tokens indexed' })
      )
    })

    // Partial-submission toast must also have fired.
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Partial submission' })
    )

    // No timeout/failure message.
    expect(screen.queryByText(/timed out waiting/i)).not.toBeInTheDocument()
  }, 15000)
})
