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
  buildArtBlocksVendorReleaseId,
  fetchReleaseTokens,
  INDEXER_VENDOR_ARTBLOCKS,
  INDEXER_VENDOR_FERALFILE,
  IndexerAPIError,
  MAX_RELEASE_TOKENS,
  resolveRelease,
  type IndexerReleaseSummary,
  type IndexerToken,
} from '@/lib/indexerApi'
import { indexerTokensToPlaylistItems } from '@/lib/indexerToPlaylistItem'
import { useToast } from '@/hooks/use-toast'
import type { PlaylistItem } from '@/types/dp1'

type VendorChoice = typeof INDEXER_VENDOR_FERALFILE | typeof INDEXER_VENDOR_ARTBLOCKS

type PanelPhase = 'idle' | 'loading' | 'loaded' | 'error'

interface LoadedRelease {
  release: IndexerReleaseSummary
  tokens: IndexerToken[]
}

interface SeriesExpanderProps {
  onAdd: (items: PlaylistItem[], releaseName: string | null) => void
}

function vendorReleaseIdFromForm(
  vendor: VendorChoice,
  ffSeriesId: string,
  abContract: string,
  abProjectId: string
): string | null {
  if (vendor === INDEXER_VENDOR_FERALFILE) {
    const id = ffSeriesId.trim()
    return id || null
  }
  const contract = abContract.trim()
  const projectId = abProjectId.trim()
  if (!contract || !projectId) return null
  return buildArtBlocksVendorReleaseId(contract, projectId)
}

export default function SeriesExpander({ onAdd }: SeriesExpanderProps) {
  const { toast } = useToast()
  const [collapsed, setCollapsed] = useState(false)
  const [vendor, setVendor] = useState<VendorChoice>(INDEXER_VENDOR_FERALFILE)
  const [ffSeriesId, setFfSeriesId] = useState('')
  const [abContract, setAbContract] = useState('')
  const [abProjectId, setAbProjectId] = useState('')
  const [phase, setPhase] = useState<PanelPhase>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<LoadedRelease | null>(null)
  const [adding, setAdding] = useState(false)
  const loadGenerationRef = useRef(0)

  const resetLoaded = useCallback(() => {
    setLoaded(null)
    setPhase('idle')
    setErrorMessage(null)
  }, [])

  const handleVendorChange = (value: VendorChoice) => {
    loadGenerationRef.current += 1
    setVendor(value)
    setFfSeriesId('')
    setAbContract('')
    setAbProjectId('')
    resetLoaded()
  }

  const handleLoad = async () => {
    const vendorReleaseId = vendorReleaseIdFromForm(vendor, ffSeriesId, abContract, abProjectId)
    if (!vendorReleaseId) {
      setErrorMessage(
        vendor === INDEXER_VENDOR_FERALFILE
          ? 'Enter a Feral File series ID.'
          : 'Enter contract address and project ID.'
      )
      setPhase('error')
      return
    }

    const generation = loadGenerationRef.current + 1
    loadGenerationRef.current = generation
    setPhase('loading')
    setErrorMessage(null)
    setLoaded(null)

    try {
      const release = await resolveRelease(vendor, vendorReleaseId)
      if (loadGenerationRef.current !== generation) return

      if (!release) {
        setErrorMessage('Release not found. Check the ID and try again.')
        setPhase('error')
        return
      }

      const tokens = await fetchReleaseTokens(release.id)
      if (loadGenerationRef.current !== generation) return

      setLoaded({ release, tokens })
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

  const handleCancel = () => {
    resetLoaded()
  }

  const handleAdd = () => {
    if (!loaded) return
    setAdding(true)
    try {
      const { items, skippedCount } = indexerTokensToPlaylistItems(loaded.tokens)
      if (items.length === 0) {
        setErrorMessage('No tokens with a renderable source URL could be added.')
        setPhase('error')
        return
      }

      onAdd(items, loaded.release.name)
      toast({
        title: 'Series added',
        description: `Added ${items.length} item(s) to the playlist.${
          skippedCount > 0 ? ` ${skippedCount} skipped (no URL).` : ''
        }`,
      })
      resetLoaded()
    } finally {
      setAdding(false)
    }
  }

  const totalMints = loaded?.release.total_mints ?? null
  const fetchedCount = loaded?.tokens.length ?? 0
  const addPreview =
    loaded != null ? indexerTokensToPlaylistItems(loaded.tokens) : null
  const addableCount = addPreview?.items.length ?? 0
  const skippedCount = addPreview?.skippedCount ?? 0
  const capped =
    totalMints != null && totalMints > MAX_RELEASE_TOKENS && fetchedCount >= MAX_RELEASE_TOKENS
  const partialMintSet =
    totalMints != null && fetchedCount < totalMints && !capped

  const loadDisabled = phase === 'loading'

  return (
    <Card className="border-primary/30 bg-primary/[0.03] shadow-sm">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-lg">Load from series</CardTitle>
            <CardDescription>
              Resolve a Feral File series or Art Blocks project via the indexer and expand mint-ordered
              tokens into playlist items.
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
                onValueChange={(v) => handleVendorChange(v as VendorChoice)}
                disabled={loadDisabled}
              >
                <SelectTrigger id="series-vendor">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={INDEXER_VENDOR_FERALFILE}>Feral File series</SelectItem>
                  <SelectItem value={INDEXER_VENDOR_ARTBLOCKS}>Art Blocks project</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {vendor === INDEXER_VENDOR_FERALFILE ? (
            <div className="space-y-2">
              <Label htmlFor="ff-series-id">Series ID</Label>
              <Input
                id="ff-series-id"
                value={ffSeriesId}
                onChange={(e) => {
                  setFfSeriesId(e.target.value)
                  if (phase !== 'idle') resetLoaded()
                }}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                disabled={loadDisabled}
              />
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ab-contract">Contract address</Label>
                <Input
                  id="ab-contract"
                  value={abContract}
                  onChange={(e) => {
                    setAbContract(e.target.value)
                    if (phase !== 'idle') resetLoaded()
                  }}
                  placeholder="0x..."
                  disabled={loadDisabled}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ab-project-id">Project ID</Label>
                <Input
                  id="ab-project-id"
                  value={abProjectId}
                  onChange={(e) => {
                    setAbProjectId(e.target.value)
                    if (phase !== 'idle') resetLoaded()
                  }}
                  placeholder="42"
                  disabled={loadDisabled}
                />
              </div>
            </div>
          )}

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

          {phase === 'loaded' && loaded && (
            <div className="space-y-3 rounded-xl border border-border/50 bg-muted/30 p-4">
              <div>
                <p className="font-medium">{loaded.release.name || 'Untitled release'}</p>
                <p className="text-sm text-muted-foreground">
                  {totalMints != null ? `${totalMints} total mints` : 'Total mints unknown'}
                  {' · '}
                  {fetchedCount} token{fetchedCount === 1 ? '' : 's'} fetched
                </p>
              </div>

              {capped && totalMints != null && (
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
                  Only {MAX_RELEASE_TOKENS} of {totalMints} tokens will be added (indexer limit).
                </p>
              )}

              {partialMintSet && (
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
                  Fetched {fetchedCount} of {totalMints} total mints. Some members may not be indexed yet.
                </p>
              )}

              {skippedCount > 0 && (
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
                  {skippedCount} token{skippedCount === 1 ? '' : 's'} have no renderable URL and will be
                  skipped.
                </p>
              )}

              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" onClick={handleCancel} disabled={adding}>
                  Cancel
                </Button>
                <Button type="button" onClick={handleAdd} disabled={adding || addableCount === 0}>
                  {adding ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Adding…
                    </>
                  ) : (
                    `Add ${addableCount} item${addableCount === 1 ? '' : 's'} to playlist`
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
