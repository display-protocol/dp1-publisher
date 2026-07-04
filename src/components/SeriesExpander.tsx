/**
 * SeriesExpander — curator panel for loading tokens from a vendor release into the playlist.
 *
 * Supported vendors: feralfile, artblocks, fxhash, objkt.
 * Input: vendor slug + optional mint numbers spec ("1..100" or "1,3,5").
 *
 * Load flow:
 *   1. resolveReleaseBySlug  → release name, total_mints (for display)
 *   2. fetchTokensByVendorSlug → actual indexed tokens (batched by mint spec or paginated)
 *   3. Gap detection: mints in spec that are absent from the response
 *
 * Gap indexing flow (requires a mint spec to enumerate gaps):
 *   Phase 1 — triggerReleaseIndexingBatched → job_ids; poll jobStatus every 3s until all succeeded
 *   Phase 2 — poll fetchTokensByVendorSlug(gapMints) every 5s until all gaps filled or timeout
 *   On done — re-fetch full token set; recompute gaps (should be zero)
 *
 * The loadGenerationRef counter aborts stale async callbacks when the user re-loads or
 * changes vendor/slug mid-flight.
 */

import { useCallback, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  fetchJobStatus,
  fetchTokensByVendorSlug,
  INDEXER_VENDOR_ARTBLOCKS,
  INDEXER_VENDOR_FERALFILE,
  INDEXER_VENDOR_FXHASH,
  INDEXER_VENDOR_OBJKT,
  IndexerAPIError,
  MintSpecParseError,
  parseMintSpec,
  resolveReleaseBySlug,
  triggerReleaseIndexingBatched,
  type IndexerJobStatus,
  type IndexerReleaseSummary,
  type IndexerToken,
  type MintSpec,
} from '@/lib/indexerApi'
import { indexerTokensToPlaylistItems } from '@/lib/indexerToPlaylistItem'
import { useToast } from '@/hooks/use-toast'
import type { PlaylistItem } from '@/types/dp1'

type VendorChoice =
  | typeof INDEXER_VENDOR_FERALFILE
  | typeof INDEXER_VENDOR_ARTBLOCKS
  | typeof INDEXER_VENDOR_FXHASH
  | typeof INDEXER_VENDOR_OBJKT

type PanelPhase = 'idle' | 'loading' | 'loaded' | 'error'

type IndexingPhase = null | 'triggering' | 'phase1' | 'phase2' | 'done' | 'failed'

interface LoadedRelease {
  release: IndexerReleaseSummary | null
  tokens: IndexerToken[]
  /** The mint spec that was used to load these tokens (null = all tokens). */
  mintSpec: MintSpec | null
  /** Mints from mintSpec that were absent in the indexed response. */
  gapMints: number[]
}

interface IndexingState {
  phase: IndexingPhase
  jobIds: number[]
  jobStatuses: IndexerJobStatus[]
  /** Count of gap mints confirmed indexed so far in Phase 2. */
  indexedSoFar: number
  errorMessage: string | null
}

interface SeriesExpanderProps {
  /** Current export-ready item count in the parent playlist (used to warn before replacing). */
  currentItemCount: number
  onAdd: (items: PlaylistItem[], releaseName: string | null) => void
}

const VENDOR_LABELS: Record<VendorChoice, string> = {
  [INDEXER_VENDOR_FERALFILE]: 'Feral File series',
  [INDEXER_VENDOR_ARTBLOCKS]: 'Art Blocks project',
  [INDEXER_VENDOR_FXHASH]: 'fxhash release',
  [INDEXER_VENDOR_OBJKT]: 'objkt collection',
}

const SLUG_PLACEHOLDERS: Record<VendorChoice, string> = {
  [INDEXER_VENDOR_FERALFILE]: 'my-series-title',
  [INDEXER_VENDOR_ARTBLOCKS]: 'fidenza-by-tyler-hobbs',
  [INDEXER_VENDOR_FXHASH]: 'geometry-runners',
  [INDEXER_VENDOR_OBJKT]: 'KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton',
}

/** Polling interval for Phase 1 job status checks (ms). */
const PHASE1_POLL_MS = 3000
/** Polling interval for Phase 2 token appearance checks (ms). */
const PHASE2_POLL_MS = 5000
/** Max poll attempts before declaring a timeout (Phase 1 and Phase 2 share this limit). */
const MAX_POLL_ATTEMPTS = 60
/** Consecutive Phase 2 polls with no new tokens before declaring a stall. */
const PHASE2_STALL_THRESHOLD = 6

function computeGapMints(mintSpec: MintSpec | null, tokens: IndexerToken[]): number[] {
  if (!mintSpec) return []
  const fetched = new Set(tokens.map((t) => t.mint_number).filter((n): n is number => n != null))
  return mintSpec.filter((n) => !fetched.has(n))
}

const initialIndexingState: IndexingState = {
  phase: null,
  jobIds: [],
  jobStatuses: [],
  indexedSoFar: 0,
  errorMessage: null,
}

export default function SeriesExpander({ currentItemCount, onAdd }: SeriesExpanderProps) {
  const { toast } = useToast()
  const [collapsed, setCollapsed] = useState(false)
  const [vendor, setVendor] = useState<VendorChoice>(INDEXER_VENDOR_FERALFILE)
  const [slug, setSlug] = useState('')
  const [mintInput, setMintInput] = useState('')
  const [mintParseError, setMintParseError] = useState<string | null>(null)
  const [phase, setPhase] = useState<PanelPhase>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<LoadedRelease | null>(null)
  const [indexing, setIndexing] = useState<IndexingState>(initialIndexingState)
  const [adding, setAdding] = useState(false)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const loadGenerationRef = useRef(0)

  const resetLoaded = useCallback(() => {
    setLoaded(null)
    setPhase('idle')
    setErrorMessage(null)
    setConfirmReplace(false)
    setIndexing(initialIndexingState)
  }, [])

  const handleVendorChange = (value: VendorChoice) => {
    loadGenerationRef.current += 1
    setVendor(value)
    setSlug('')
    setMintInput('')
    setMintParseError(null)
    resetLoaded()
  }

  const handleMintInputChange = (value: string) => {
    setMintInput(value)
    setMintParseError(null)
    if (phase !== 'idle') resetLoaded()
  }

  const handleSlugChange = (value: string) => {
    setSlug(value)
    if (phase !== 'idle') resetLoaded()
  }

  // ---------------------------------------------------------------------------
  // Load
  // ---------------------------------------------------------------------------

  const handleLoad = async () => {
    const trimmedSlug = slug.trim()
    if (!trimmedSlug) {
      setErrorMessage('Enter a release slug.')
      setPhase('error')
      return
    }

    // Parse mint spec before issuing any network requests.
    let mintSpec: MintSpec | null = null
    try {
      mintSpec = parseMintSpec(mintInput)
    } catch (e) {
      const msg = e instanceof MintSpecParseError ? e.message : 'Invalid mint numbers input.'
      setMintParseError(msg)
      return
    }

    const generation = loadGenerationRef.current + 1
    loadGenerationRef.current = generation
    setPhase('loading')
    setErrorMessage(null)
    setLoaded(null)
    setIndexing(initialIndexingState)

    try {
      // Fetch release metadata and tokens concurrently.
      const [release, tokens] = await Promise.all([
        resolveReleaseBySlug(vendor, trimmedSlug),
        fetchTokensByVendorSlug(vendor, trimmedSlug, mintSpec ?? undefined),
      ])
      if (loadGenerationRef.current !== generation) return

      // Proceed even when nothing is indexed yet — the preview will offer to trigger
      // indexing when a mint spec is provided, or prompt the curator to enter one.
      const gapMints = computeGapMints(mintSpec, tokens)
      setLoaded({ release, tokens, mintSpec, gapMints })
      setPhase('loaded')
    } catch (e) {
      if (loadGenerationRef.current !== generation) return
      const message =
        e instanceof IndexerAPIError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Failed to load release from indexer.'
      setErrorMessage(message)
      setPhase('error')
    }
  }

  // ---------------------------------------------------------------------------
  // Add to playlist
  // ---------------------------------------------------------------------------

  const doAdd = () => {
    if (!loaded) return
    setAdding(true)
    try {
      const { items, skippedCount } = indexerTokensToPlaylistItems(loaded.tokens)
      if (items.length === 0) {
        setErrorMessage('No tokens with a renderable source URL could be added.')
        setPhase('error')
        return
      }
      onAdd(items, loaded.release?.name ?? null)
      toast({
        title: 'Playlist replaced',
        description: `${items.length} item${items.length === 1 ? '' : 's'} loaded from series.${
          skippedCount > 0 ? ` ${skippedCount} skipped (no URL).` : ''
        }`,
      })
      resetLoaded()
    } finally {
      setAdding(false)
    }
  }

  const handleAdd = () => {
    if (currentItemCount > 0 && !confirmReplace) {
      setConfirmReplace(true)
      return
    }
    doAdd()
  }

  // ---------------------------------------------------------------------------
  // Index missing tokens
  // ---------------------------------------------------------------------------

  const handleIndexMissing = async () => {
    if (!loaded?.gapMints.length) return

    const { gapMints } = loaded
    const generation = loadGenerationRef.current

    // Phase: triggering
    setIndexing({ ...initialIndexingState, phase: 'triggering' })

    let jobIds: number[]
    try {
      jobIds = await triggerReleaseIndexingBatched(vendor, slug.trim(), gapMints)
    } catch (e) {
      if (loadGenerationRef.current !== generation) return
      const msg = e instanceof Error ? e.message : 'Failed to submit indexing job.'
      setIndexing({ ...initialIndexingState, phase: 'failed', errorMessage: msg })
      return
    }
    if (loadGenerationRef.current !== generation) return

    // Phase 1: poll jobStatus until all jobs succeed or any fail.
    setIndexing({ ...initialIndexingState, phase: 'phase1', jobIds })
    let pollAttempts = 0
    while (pollAttempts < MAX_POLL_ATTEMPTS) {
      await sleep(PHASE1_POLL_MS)
      if (loadGenerationRef.current !== generation) return

      let statuses: (IndexerJobStatus | null)[]
      try {
        statuses = await Promise.all(jobIds.map((id) => fetchJobStatus(id)))
      } catch (e) {
        if (loadGenerationRef.current !== generation) return
        const msg = e instanceof Error ? e.message : 'Failed to check job status.'
        setIndexing((prev) => ({ ...prev, phase: 'failed', errorMessage: msg }))
        return
      }
      if (loadGenerationRef.current !== generation) return

      // A null status means the job was not found — treat as terminal failure.
      const nullIdx = statuses.findIndex((s) => s === null)
      if (nullIdx !== -1) {
        setIndexing((prev) => ({
          ...prev,
          phase: 'failed',
          errorMessage: `Job #${jobIds[nullIdx]} not found on indexer.`,
        }))
        return
      }

      const nonNull = statuses as IndexerJobStatus[]
      setIndexing((prev) => ({ ...prev, jobStatuses: nonNull }))

      // "canceled" is a terminal failure state alongside "failed".
      const terminal = nonNull.find((s) => s.status === 'failed' || s.status === 'canceled')
      if (terminal) {
        const msg =
          terminal.last_error ??
          `Job #${terminal.job_id} ${terminal.status}.`
        setIndexing((prev) => ({ ...prev, phase: 'failed', errorMessage: msg }))
        return
      }

      const allSucceeded = nonNull.every((s) => s.status === 'succeeded')
      if (allSucceeded) break

      pollAttempts++
    }

    if (pollAttempts >= MAX_POLL_ATTEMPTS) {
      setIndexing((prev) => ({
        ...prev,
        phase: 'failed',
        errorMessage: 'Timed out waiting for indexing jobs to complete.',
      }))
      return
    }
    if (loadGenerationRef.current !== generation) return

    // Phase 2: poll token appearance for the gap mints.
    setIndexing((prev) => ({ ...prev, phase: 'phase2' }))
    let prevIndexedCount = 0
    let stallCount = 0
    pollAttempts = 0

    while (pollAttempts < MAX_POLL_ATTEMPTS) {
      await sleep(PHASE2_POLL_MS)
      if (loadGenerationRef.current !== generation) return

      let freshTokens: IndexerToken[]
      try {
        freshTokens = await fetchTokensByVendorSlug(vendor, slug.trim(), gapMints)
      } catch (e) {
        if (loadGenerationRef.current !== generation) return
        const msg = e instanceof Error ? e.message : 'Failed to poll for indexed tokens.'
        setIndexing((prev) => ({ ...prev, phase: 'failed', errorMessage: msg }))
        return
      }
      if (loadGenerationRef.current !== generation) return

      const gapSet = new Set(gapMints)
      const indexedSoFar = freshTokens.filter(
        (t) => t.mint_number != null && gapSet.has(t.mint_number)
      ).length
      setIndexing((prev) => ({ ...prev, indexedSoFar }))

      if (indexedSoFar >= gapMints.length) break

      if (indexedSoFar === prevIndexedCount) {
        stallCount++
        if (stallCount >= PHASE2_STALL_THRESHOLD) break
      } else {
        stallCount = 0
      }
      prevIndexedCount = indexedSoFar
      pollAttempts++
    }

    if (loadGenerationRef.current !== generation) return

    // Re-fetch the full token set (original mintSpec) to rebuild loaded state.
    setIndexing((prev) => ({ ...prev, phase: 'done' }))
    try {
      const refreshedTokens = await fetchTokensByVendorSlug(
        vendor,
        slug.trim(),
        loaded.mintSpec ?? undefined
      )
      if (loadGenerationRef.current !== generation) return

      const newGapMints = computeGapMints(loaded.mintSpec, refreshedTokens)
      const newCount = refreshedTokens.length - loaded.tokens.length
      setLoaded((prev) =>
        prev ? { ...prev, tokens: refreshedTokens, gapMints: newGapMints } : prev
      )
      setIndexing(initialIndexingState)
      if (newCount > 0) {
        toast({
          title: 'Tokens indexed',
          description: `${newCount} new token${newCount === 1 ? '' : 's'} are now available.`,
        })
      }
    } catch {
      // Non-fatal: the user can still proceed with whatever tokens are loaded.
      setIndexing(initialIndexingState)
    }
  }

  // ---------------------------------------------------------------------------
  // Derived display values
  // ---------------------------------------------------------------------------

  const totalMints = loaded?.release?.total_mints ?? null
  const fetchedCount = loaded?.tokens.length ?? 0
  const addPreview = loaded != null ? indexerTokensToPlaylistItems(loaded.tokens) : null
  const addableCount = addPreview?.items.length ?? 0
  const skippedCount = addPreview?.skippedCount ?? 0
  const gapMints = loaded?.gapMints ?? []
  const gapCount = gapMints.length
  const mintSpec = loaded?.mintSpec ?? null

  // Without a spec we fall back to comparing fetchedCount vs total_mints (no explicit gaps).
  const partialMintSet = !mintSpec && totalMints != null && fetchedCount < totalMints

  const loadDisabled = phase === 'loading'
  const indexingActive =
    indexing.phase === 'triggering' || indexing.phase === 'phase1' || indexing.phase === 'phase2'

  const gapExampleText =
    gapMints.length > 0
      ? `mints: ${gapMints.slice(0, 5).join(', ')}${gapMints.length > 5 ? ', …' : ''}`
      : ''

  return (
    <Card className="border-primary/30 bg-primary/[0.03] shadow-sm">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-lg">Load from series</CardTitle>
            <CardDescription>
              Resolve tokens from a Feral File series, Art Blocks project, fxhash release, or objkt
              collection and expand them into playlist items.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 px-2"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand series panel' : 'Collapse series panel'}
          >
            {collapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          </Button>
        </div>
      </CardHeader>

      {!collapsed && (
        <CardContent className="space-y-4">
          {/* Vendor + Slug row */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="series-vendor">Vendor</Label>
              <Select
                value={vendor}
                onValueChange={(v) => handleVendorChange(v as VendorChoice)}
                disabled={loadDisabled}
              >
                <SelectTrigger id="series-vendor">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(VENDOR_LABELS) as VendorChoice[]).map((v) => (
                    <SelectItem key={v} value={v}>
                      {VENDOR_LABELS[v]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="series-slug">Release slug</Label>
              <Input
                id="series-slug"
                value={slug}
                onChange={(e) => handleSlugChange(e.target.value)}
                placeholder={SLUG_PLACEHOLDERS[vendor]}
                disabled={loadDisabled}
              />
            </div>
          </div>

          {/* Mint numbers input */}
          <div className="space-y-2">
            <Label htmlFor="series-mint-numbers">
              Mint numbers{' '}
              <span className="text-xs font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="series-mint-numbers"
              value={mintInput}
              onChange={(e) => handleMintInputChange(e.target.value)}
              placeholder="e.g. 1..100 or 1,3,5  — leave empty to load all"
              disabled={loadDisabled}
            />
            {mintParseError && (
              <p className="text-xs text-destructive" role="alert">
                {mintParseError}
              </p>
            )}
          </div>

          <div className="flex justify-end">
            <Button type="button" onClick={handleLoad} disabled={loadDisabled}>
              {phase === 'loading' ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Loading…
                </>
              ) : (
                'Load series'
              )}
            </Button>
          </div>

          {errorMessage && phase === 'error' && (
            <p className="text-sm text-destructive" role="alert">
              {errorMessage}
            </p>
          )}

          {/* Loaded preview */}
          {phase === 'loaded' && loaded && (
            <div className="space-y-3 rounded-xl border border-border/50 bg-muted/30 p-4">
              <div>
                <p className="font-medium">
                  {loaded.release?.name ||
                    (fetchedCount === 0 ? 'Release not yet indexed' : 'Untitled release')}
                </p>
                <p className="text-sm text-muted-foreground">
                  {totalMints != null ? `${totalMints} total mints` : 'Total mints unknown'}
                  {' · '}
                  {fetchedCount} token{fetchedCount === 1 ? '' : 's'} fetched
                  {mintSpec ? ` (from ${mintSpec.length} requested)` : ''}
                </p>
              </div>

              {/* No tokens and no mint spec — prompt the curator to enter mint numbers */}
              {fetchedCount === 0 && !mintSpec && !indexingActive && (
                <p className="rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-sm text-blue-900 dark:text-blue-100">
                  No tokens found for this release. Enter mint numbers above and click{' '}
                  <strong>Load series</strong> again to trigger indexing of specific mints.
                </p>
              )}

              {/* Explicit gap warning (mint spec was provided) */}
              {gapCount > 0 && mintSpec && !indexingActive && indexing.phase !== 'done' && (
                <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                  <p className="text-sm text-amber-900 dark:text-amber-100">
                    {gapCount} token{gapCount === 1 ? '' : 's'} not yet indexed
                    {gapExampleText ? ` (${gapExampleText})` : ''}.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleIndexMissing}
                    disabled={indexingActive}
                    className="border-amber-500/60 bg-amber-500/10 text-amber-900 hover:bg-amber-500/20 dark:text-amber-100"
                  >
                    Index missing tokens
                  </Button>
                </div>
              )}

              {/* Partial mint set warning (no spec, but total_mints shows a shortfall) */}
              {partialMintSet && (
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
                  Fetched {fetchedCount} of {totalMints} total mints. Some tokens may not be indexed
                  yet. Enter a mint range to identify and index specific gaps.
                </p>
              )}

              {/* Indexing status */}
              {indexing.phase === 'triggering' && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Submitting indexing job{indexing.jobIds.length > 1 ? 's' : ''}…
                </div>
              )}

              {indexing.phase === 'phase1' && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Enqueueing token indexing jobs…
                  </div>
                  {indexing.jobIds.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Job{indexing.jobIds.length > 1 ? 's' : ''} #{indexing.jobIds.join(', #')}
                    </p>
                  )}
                </div>
              )}

              {indexing.phase === 'phase2' && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Waiting for tokens to be indexed… ({indexing.indexedSoFar} /{' '}
                  {gapCount} indexed)
                </div>
              )}

              {indexing.phase === 'done' && (
                <p className="text-sm text-green-700 dark:text-green-400">
                  Indexing complete. Token list updated.
                </p>
              )}

              {indexing.phase === 'failed' && indexing.errorMessage && (
                <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  Indexing failed: {indexing.errorMessage}
                </p>
              )}

              {skippedCount > 0 && (
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
                  {skippedCount} token{skippedCount === 1 ? '' : 's'} have no renderable URL and
                  will be skipped.
                </p>
              )}

              {confirmReplace && (
                <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  This will replace the {currentItemCount} existing item
                  {currentItemCount === 1 ? '' : 's'} in the playlist. Confirm to continue.
                </p>
              )}

              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (confirmReplace) {
                      setConfirmReplace(false)
                    } else {
                      resetLoaded()
                    }
                  }}
                  disabled={adding || indexingActive}
                >
                  {confirmReplace ? 'Go back' : 'Cancel'}
                </Button>
                <Button
                  type="button"
                  onClick={handleAdd}
                  disabled={adding || addableCount === 0 || indexingActive}
                >
                  {adding ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Replacing…
                    </>
                  ) : confirmReplace ? (
                    `Yes, replace with ${addableCount} item${addableCount === 1 ? '' : 's'}`
                  ) : (
                    `Load ${addableCount} item${addableCount === 1 ? '' : 's'} into playlist`
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
