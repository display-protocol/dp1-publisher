/**
 * SeriesExpander — curator panel for loading tokens from a vendor release into the playlist.
 *
 * Supported vendors: Feral File (series slug), Art Blocks (project slug), objkt
 * (custom-collection KT1 address). Input: slug + optional mint spec ("1..100" or "1,3,5").
 *
 * Load is a single read-only call to `loadVendorRelease`, which talks to the vendor's
 * public API directly (src/lib/vendors/). There is no indexing step: a requested mint the
 * vendor does not list is shown as a gap, for information only.
 *
 * loadGenerationRef discards a load that resolves after the curator changed vendor,
 * slug or mint input, or started another load.
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
import { MintSpecParseError, parseMintSpec, type MintSpec } from '@/lib/mintSpec'
import {
  loadVendorRelease,
  VENDOR_ARTBLOCKS,
  VENDOR_FERALFILE,
  VENDOR_LABELS,
  VENDOR_OBJKT,
  VENDORS,
  VendorAPIError,
  type Vendor,
  type VendorRelease,
  type VendorToken,
} from '@/lib/vendors'
import { vendorTokensToPlaylistItems } from '@/lib/vendorTokenToPlaylistItem'
import { useToast } from '@/hooks/use-toast'
import type { PlaylistItem } from '@/types/dp1'

type PanelPhase = 'idle' | 'loading' | 'loaded' | 'error'

interface LoadedRelease {
  release: VendorRelease
  tokens: VendorToken[]
  /** The mint spec that was used to load these tokens (null = all tokens). */
  mintSpec: MintSpec | null
  /** Mints from mintSpec the vendor checked and did not return. */
  gapMints: number[]
  /** Mints from mintSpec the loader never reached (request bound). */
  uncheckedMints: number[]
  /** Load-all stopped at the client cap while the release has more tokens. */
  wasCapped: boolean
}

interface SeriesExpanderProps {
  /** Current export-ready item count in the parent playlist (used to warn before replacing). */
  currentItemCount: number
  onAdd: (items: PlaylistItem[], releaseName: string | null) => void
}

const VENDOR_OPTION_LABELS: Record<Vendor, string> = {
  [VENDOR_FERALFILE]: 'Feral File series',
  [VENDOR_ARTBLOCKS]: 'Art Blocks project',
  [VENDOR_OBJKT]: 'objkt collection',
}

const SLUG_LABELS: Record<Vendor, string> = {
  [VENDOR_FERALFILE]: 'Series slug',
  [VENDOR_ARTBLOCKS]: 'Project slug',
  [VENDOR_OBJKT]: 'Contract address',
}

const SLUG_PLACEHOLDERS: Record<Vendor, string> = {
  [VENDOR_FERALFILE]: 'my-series-title',
  [VENDOR_ARTBLOCKS]: 'fidenza-by-tyler-hobbs',
  // A custom (single-artist) contract: shared contracts such as hic et nunc are refused.
  [VENDOR_OBJKT]: 'KT1XR4XgBJ2RZz1vW22q6EKdSNgYbmaaWr5z',
}

/**
 * Moderated tokens count as present: the vendor lists them, the mapper just refuses
 * to turn them into items. Only mints the vendor checked and did not return are
 * gaps; mints the loader never reached are reported separately.
 */
function computeGapMints(
  mintSpec: MintSpec | null,
  tokens: VendorToken[],
  uncheckedMints: number[]
): number[] {
  if (!mintSpec) return []
  const known = new Set([...tokens.map((t) => t.mintNumber), ...uncheckedMints])
  return mintSpec.filter((n) => !known.has(n))
}

function mintExamples(mints: number[]): string {
  return `${mints.slice(0, 5).join(', ')}${mints.length > 5 ? ', …' : ''}`
}

export default function SeriesExpander({ currentItemCount, onAdd }: SeriesExpanderProps) {
  const { toast } = useToast()
  const [collapsed, setCollapsed] = useState(false)
  const [vendor, setVendor] = useState<Vendor>(VENDOR_FERALFILE)
  const [slug, setSlug] = useState('')
  const [mintInput, setMintInput] = useState('')
  const [mintParseError, setMintParseError] = useState<string | null>(null)
  const [phase, setPhase] = useState<PanelPhase>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<LoadedRelease | null>(null)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const loadGenerationRef = useRef(0)

  const resetLoaded = useCallback(() => {
    loadGenerationRef.current += 1
    setLoaded(null)
    setPhase('idle')
    setErrorMessage(null)
    setConfirmReplace(false)
  }, [])

  const handleVendorChange = (value: Vendor) => {
    setVendor(value)
    setSlug('')
    setMintInput('')
    setMintParseError(null)
    resetLoaded()
  }

  const handleSlugChange = (value: string) => {
    setSlug(value)
    if (phase !== 'idle') resetLoaded()
  }

  const handleMintInputChange = (value: string) => {
    setMintInput(value)
    setMintParseError(null)
    if (phase !== 'idle') resetLoaded()
  }

  const handleLoad = async () => {
    const trimmedSlug = slug.trim()
    if (!trimmedSlug) {
      setErrorMessage(`Enter a ${SLUG_LABELS[vendor].toLowerCase()}.`)
      setPhase('error')
      return
    }

    let mintSpec: MintSpec | null = null
    try {
      mintSpec = parseMintSpec(mintInput)
    } catch (e) {
      setMintParseError(e instanceof MintSpecParseError ? e.message : 'Invalid mint numbers input.')
      return
    }

    const generation = loadGenerationRef.current + 1
    loadGenerationRef.current = generation
    setPhase('loading')
    setErrorMessage(null)
    setLoaded(null)
    setConfirmReplace(false)

    try {
      const { release, tokens, wasCapped, uncheckedMints } = await loadVendorRelease(
        vendor,
        trimmedSlug,
        mintSpec
      )
      if (loadGenerationRef.current !== generation) return
      setLoaded({
        release,
        tokens,
        mintSpec,
        gapMints: computeGapMints(mintSpec, tokens, uncheckedMints),
        uncheckedMints,
        wasCapped,
      })
      setPhase('loaded')
    } catch (e) {
      if (loadGenerationRef.current !== generation) return
      // VendorAPIError messages are written for the curator; anything else is an
      // internal failure (e.g. a vendor response shape drifting) and stays generic.
      setErrorMessage(e instanceof VendorAPIError ? e.message : 'Failed to load release.')
      setPhase('error')
    }
  }

  const preview = loaded ? vendorTokensToPlaylistItems(loaded.tokens) : null
  const addableCount = preview?.items.length ?? 0
  const skippedCount = preview?.skippedCount ?? 0
  const moderatedCount = preview?.moderatedCount ?? 0

  const handleAdd = () => {
    if (!loaded || !preview) return
    if (currentItemCount > 0 && !confirmReplace) {
      setConfirmReplace(true)
      return
    }
    if (preview.items.length === 0) {
      setErrorMessage('No tokens with a renderable source URL could be added.')
      setPhase('error')
      return
    }
    onAdd(preview.items, loaded.release.name)
    toast({
      title: 'Playlist replaced',
      description: `${preview.items.length} item${preview.items.length === 1 ? '' : 's'} loaded from series.${
        skippedCount > 0 ? ` ${skippedCount} skipped.` : ''
      }`,
    })
    resetLoaded()
  }

  const loading = phase === 'loading'
  const totalMints = loaded?.release.totalMints ?? null
  const fetchedCount = loaded?.tokens.length ?? 0
  const gapMints = loaded?.gapMints ?? []
  const gapCount = gapMints.length
  const uncheckedMints = loaded?.uncheckedMints ?? []
  const mintSpec = loaded?.mintSpec ?? null
  const wasCapped = loaded?.wasCapped ?? false
  // The loaded release, not the dropdown, names the vendor the results came from.
  const loadedVendorLabel = VENDOR_LABELS[loaded?.release.vendor ?? vendor]

  return (
    <Card className="border-primary/30 bg-primary/[0.03] shadow-sm">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-lg">Load from series</CardTitle>
            <CardDescription>
              Resolve tokens from a Feral File series, Art Blocks project, or objkt collection and
              expand them into playlist items.
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
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="series-vendor">Vendor</Label>
              <Select
                value={vendor}
                onValueChange={(v) => handleVendorChange(v as Vendor)}
                disabled={loading}
              >
                <SelectTrigger id="series-vendor">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VENDORS.map((v) => (
                    <SelectItem key={v} value={v}>
                      {VENDOR_OPTION_LABELS[v]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="series-slug">{SLUG_LABELS[vendor]}</Label>
              <Input
                id="series-slug"
                value={slug}
                onChange={(e) => handleSlugChange(e.target.value)}
                placeholder={SLUG_PLACEHOLDERS[vendor]}
                disabled={loading}
              />
            </div>
          </div>

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
              disabled={loading}
            />
            {mintParseError && (
              <p className="text-xs text-destructive" role="alert">
                {mintParseError}
              </p>
            )}
          </div>

          <div className="flex justify-end">
            <Button type="button" onClick={handleLoad} disabled={loading}>
              {loading ? (
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

          {phase === 'loaded' && loaded && (
            <div className="space-y-3 rounded-xl border border-border/50 bg-muted/30 p-4">
              <div>
                <p className="font-medium">{loaded.release.name || 'Untitled release'}</p>
                <p className="text-sm text-muted-foreground">
                  {totalMints != null ? `${totalMints} total mints` : 'Total mints unknown'}
                  {' · '}
                  {fetchedCount} token{fetchedCount === 1 ? '' : 's'} fetched
                  {mintSpec ? ` (from ${mintSpec.length} requested)` : ''}
                </p>
              </div>

              {gapCount > 0 && (
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
                  {gapCount} requested mint{gapCount === 1 ? '' : 's'} not found on{' '}
                  {loadedVendorLabel} (mints: {mintExamples(gapMints)}).
                </p>
              )}

              {uncheckedMints.length > 0 && (
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
                  {uncheckedMints.length} requested mint{uncheckedMints.length === 1 ? ' was' : 's were'}{' '}
                  not checked (request limit; mints: {mintExamples(uncheckedMints)}). Load them with a
                  narrower mint range.
                </p>
              )}

              {wasCapped && (
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
                  Showing the first {fetchedCount.toLocaleString()} tokens (client limit
                  {totalMints != null
                    ? ` — ${totalMints.toLocaleString()} total mints in this release`
                    : ''}
                  ). To work with a specific subset, enter a mint range above and reload.
                </p>
              )}

              {skippedCount > 0 && (
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
                  {skippedCount} token{skippedCount === 1 ? '' : 's'} will be skipped
                  {moderatedCount > 0
                    ? ` (${moderatedCount} taken down on ${loadedVendorLabel}${
                        moderatedCount < skippedCount ? ', the rest have no renderable URL' : ''
                      })`
                    : ' (no renderable URL)'}
                  .
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
                  onClick={() => (confirmReplace ? setConfirmReplace(false) : resetLoaded())}
                >
                  {confirmReplace ? 'Go back' : 'Cancel'}
                </Button>
                <Button type="button" onClick={handleAdd} disabled={addableCount === 0}>
                  {confirmReplace
                    ? `Yes, replace with ${addableCount} item${addableCount === 1 ? '' : 's'}`
                    : wasCapped
                      ? `Load first ${addableCount} item${addableCount === 1 ? '' : 's'} into playlist`
                      : `Load ${addableCount} item${addableCount === 1 ? '' : 's'} into playlist`}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}
