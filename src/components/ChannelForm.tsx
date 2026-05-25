import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, Loader2, MinusCircle } from 'lucide-react'
import { useAccount, useWalletClient } from 'wagmi'
import { v4 as uuidv4 } from 'uuid'
import { getAddress } from 'viem'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { generateChannelSlug } from '@/lib/utils'
import { ethereumAddressToDIDPKH } from '@/lib/signing'
import { signDocument, stripSignatureFields } from '@/lib/signing'
import { channelUnsignedPayloadForSigning } from '@/lib/channelSignPayload'
import { mergeChannelForPatch } from '@/lib/dp1Merge'
import { recordPublishedChannel } from '@/lib/publishedStorage'
import {
  feedChannelResourceUrl,
  getChannel,
  patchChannel,
  publishChannel,
  validatePlaylistURI,
  isDebugMode,
} from '@/lib/api'
import { FeedUrlToastDescription } from '@/components/FeedUrlToastDescription'
import JsonFileDropZone from './JsonFileDropZone'
import { prepareChannelForPublish } from '@/lib/preparePublish'
import type { Channel, Entity } from '@/types/dp1'
import CuratorList from './CuratorList'

interface PlaylistURIStatus {
  uri: string
  valid: boolean
  reason?: string
}

function parseChannelJson(text: string): { channel: Channel } | { error: string } {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { error: 'Not valid JSON.' }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { error: 'Channel must be a JSON object.' }
  }
  const o = data as Record<string, unknown>
  const title = typeof o.title === 'string' ? o.title.trim() : ''
  if (!title) {
    return { error: 'Title is required.' }
  }
  if (!Array.isArray(o.playlists)) {
    return { error: 'Property "playlists" must be an array.' }
  }
  if (o.playlists.length === 0) {
    return { error: 'At least one playlist URI is required.' }
  }
  // Validate playlist URIs
  for (let i = 0; i < o.playlists.length; i++) {
    const u = o.playlists[i]
    if (typeof u !== 'string' || !u.trim()) {
      return { error: `playlists[${i}] must be a non-empty URI string.` }
    }
    // Validate URI format and security
    const validation = validatePlaylistURI(u.trim())
    if (!validation.valid) {
      return { error: `playlists[${i}]: ${validation.reason || 'Invalid URI'}` }
    }
  }
  return { channel: data as Channel }
}

/** Lenient parse for live JSON ↔ form sync (publish still uses strict `parseChannelJson`). */
function parseChannelJsonForFormSync(text: string): Channel | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null
  }
  const o = data as Record<string, unknown>
  if (!('title' in o)) {
    return null
  }
  if (!Array.isArray(o.playlists)) {
    return null
  }
  return data as Channel
}

function channelFromJsonImport(raw: Channel, fallbackId: string): Channel {
  const { signatures: _s, signature: _legacy, ...rest } = raw as Channel & {
    signature?: string
  }
  const created =
    typeof rest.created === 'string' && rest.created.trim() !== ''
      ? rest.created
      : new Date().toISOString()
  return {
    ...rest,
    version: rest.version || '1.0.0',
    id: rest.id || fallbackId,
    created,
  }
}

export default function ChannelForm({
  editId,
  onCancelEdit,
  onPublished,
}: {
  editId?: string
  onCancelEdit?: () => void
  onPublished?: () => void
} = {}) {
  const { address } = useAccount()
  const { data: walletClient } = useWalletClient()
  const { toast } = useToast()

  const loadedRef = useRef<Channel | null>(null)
  /** Stable `created` for new channels so JSON preview does not change every keystroke. */
  const newChannelCreatedRef = useRef<string>(new Date().toISOString())
  const [id, setId] = useState(() => uuidv4())
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoadingDoc, setIsLoadingDoc] = useState(false)
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [isAutoSlug, setIsAutoSlug] = useState(true)
  const [version, setVersion] = useState('1.0.0')
  const [summary, setSummary] = useState('')
  const [coverImage, setCoverImage] = useState('')
  
  // Publisher (always the connected wallet)
  const [publisherName, setPublisherName] = useState('')
  const [publisherUrl, setPublisherUrl] = useState('')

  // Curators (optional)
  const [curators, setCurators] = useState<Entity[]>([])

  // Playlist URIs
  const [playlistsText, setPlaylistsText] = useState('')
  const [uriStatuses, setUriStatuses] = useState<PlaylistURIStatus[]>([])

  // JSON editor
  const [jsonMode, setJsonMode] = useState<'form' | 'json'>('form')
  const [jsonText, setJsonText] = useState('')

  const [isPublishing, setIsPublishing] = useState(false)

  const isEdit = Boolean(editId)

  useEffect(() => {
    if (!editId || !address) {
      loadedRef.current = null
      return
    }
    let cancelled = false
    setLoadError(null)
    setIsLoadingDoc(true)
    getChannel(editId)
      .then((ch) => {
        if (cancelled) return
        loadedRef.current = ch
        setId(ch.id || uuidv4())
        setTitle(ch.title)
        setIsAutoSlug(false)
        setSlug(ch.slug || '')
        setVersion(ch.version || '1.0.0')
        setSummary(ch.summary || '')
        setCoverImage(ch.coverImage || '')
        const pub = ch.publisher
        setPublisherName(pub?.name || '')
        setPublisherUrl(pub?.url || '')
        setCurators(ch.curators?.length ? ch.curators : [])
        const lines = (ch.playlists ?? []).join('\n')
        setPlaylistsText(lines)
        const uris = lines
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0)
        setUriStatuses(
          uris.map((uri) => {
            const validation = validatePlaylistURI(uri)
            return {
              uri,
              valid: validation.valid,
              reason: validation.reason,
            }
          })
        )
        try {
          setJsonText(JSON.stringify(channelUnsignedPayloadForSigning(ch), null, 2))
        } catch {
          setJsonText(JSON.stringify(stripSignatureFields(ch as object), null, 2))
        }
        setJsonMode('form')
      })
      .catch((e) => {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : 'Failed to load channel')
          loadedRef.current = null
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingDoc(false)
      })
    return () => {
      cancelled = true
    }
  }, [editId, address])

  // Auto-generate slug
  const autoSlug = generateChannelSlug(title, id)
  const displaySlug = isAutoSlug ? autoSlug : slug

  const handleValidateURIs = () => {
    const uris = playlistsText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    if (uris.length === 0) {
      toast({
        title: 'Error',
        description: 'Please enter at least one playlist URI',
        variant: 'destructive',
      })
      return
    }

    const statuses: PlaylistURIStatus[] = uris.map((uri) => {
      const validation = validatePlaylistURI(uri)
      return {
        uri,
        valid: validation.valid,
        reason: validation.reason,
      }
    })

    setUriStatuses(statuses)
    toast({ title: 'Validation Complete', description: `Checked ${uris.length} URIs` })
  }

  const buildChannel = useCallback((): Channel => {
    const created = newChannelCreatedRef.current

    const playlists = playlistsText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    const publisher: Entity = {
      name: publisherName || '',
      key: ethereumAddressToDIDPKH(getAddress(address!)),
      url: publisherUrl || undefined,
    }

    return {
      id,
      slug: displaySlug,
      title,
      version,
      created,
      playlists,
      publisher,
      curators: curators.length > 0 ? curators : undefined,
      summary: summary || undefined,
      coverImage: coverImage || undefined,
    }
  }, [
    id,
    displaySlug,
    title,
    version,
    playlistsText,
    summary,
    coverImage,
    publisherName,
    publisherUrl,
    curators,
    address,
  ])

  const serializeChannelJsonPreview = useCallback((): string => {
    if (!address) {
      return ''
    }
    if (isEdit && loadedRef.current) {
      const base = loadedRef.current
      const playlists = playlistsText
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
      const publisher: Entity = {
        name: publisherName || '',
        key: ethereumAddressToDIDPKH(getAddress(address)),
        url: publisherUrl || undefined,
      }
      const patchFields = {
        title: title.trim(),
        slug: displaySlug,
        version,
        playlists,
        publisher,
        curators,
        summary: summary.trim() || undefined,
        coverImage: coverImage.trim() || undefined,
      }
      const merged = mergeChannelForPatch(base, patchFields)
      try {
        return JSON.stringify(channelUnsignedPayloadForSigning(merged), null, 2)
      } catch {
        return JSON.stringify(stripSignatureFields(merged as object), null, 2)
      }
    }
    const channel = buildChannel()
    try {
      return JSON.stringify(channelUnsignedPayloadForSigning(channel), null, 2)
    } catch {
      return JSON.stringify(channel, null, 2)
    }
  }, [
    address,
    isEdit,
    title,
    displaySlug,
    version,
    summary,
    coverImage,
    publisherName,
    publisherUrl,
    curators,
    playlistsText,
    buildChannel,
  ])

  const applyParsedChannelToForm = useCallback(
    (raw: Channel) => {
      const ch = channelFromJsonImport(raw, id)
      if (!isEdit && ch.created?.trim()) {
        newChannelCreatedRef.current = ch.created.trim()
      }
      const resolvedId = ch.id || id
      setId(resolvedId)
      setTitle(ch.title)
      const auto = generateChannelSlug(ch.title, resolvedId)
      if (!ch.slug?.trim() || ch.slug.trim() === auto) {
        setIsAutoSlug(true)
        setSlug('')
      } else {
        setIsAutoSlug(false)
        setSlug(ch.slug.trim())
      }
      setVersion(ch.version || '1.0.0')
      setSummary(ch.summary || '')
      setCoverImage(ch.coverImage || '')
      const pub = ch.publisher
      setPublisherName(pub?.name || '')
      setPublisherUrl(pub?.url || '')
      setCurators(ch.curators?.length ? ch.curators : [])
      const lines = (ch.playlists ?? []).join('\n')
      setPlaylistsText(lines)
      const uris = lines
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
      setUriStatuses(
        uris.map((uri) => {
          const validation = validatePlaylistURI(uri)
          return {
            uri,
            valid: validation.valid,
            reason: validation.reason,
          }
        })
      )
    },
    [id, isEdit]
  )

  const handleJsonTextChange = (value: string) => {
    setJsonText(value)
    const trimmed = value.trim()
    if (!trimmed) {
      return
    }
    const channel = parseChannelJsonForFormSync(trimmed)
    if (!channel) {
      return
    }
    applyParsedChannelToForm(channel)
  }

  useEffect(() => {
    if (jsonMode !== 'form' || isLoadingDoc) {
      return
    }
    if (!address) {
      return
    }
    if (isEdit && !loadedRef.current) {
      return
    }
    setJsonText(serializeChannelJsonPreview())
  }, [
    jsonMode,
    isLoadingDoc,
    address,
    isEdit,
    serializeChannelJsonPreview,
  ])

  const handleGenerateJSON = () => {
    if (!address) {
      toast({
        title: 'Error',
        description: 'Connect a wallet to build channel JSON.',
        variant: 'destructive',
      })
      return
    }
    setJsonText(serializeChannelJsonPreview())
    setJsonMode('json')
  }

  /**
   * Form-tab URI-validation gate: ensures every line in the playlists box was
   * checked and passed before we go anywhere near signing. JSON-tab mode
   * skips this — `parseChannelJson` enforces URI shape on its own.
   */
  const validateFormTabUris = (): string | null => {
    const playlists = playlistsText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    if (uriStatuses.length !== playlists.length) {
      return 'Please validate URIs before publishing'
    }
    if (uriStatuses.some((status) => !status.valid)) {
      return 'Please fix invalid URIs before publishing'
    }
    return null
  }

  const handlePublish = async () => {
    if (!walletClient || !address) {
      toast({ title: 'Error', description: 'Wallet not connected', variant: 'destructive' })
      return
    }
    if (isEdit && (!editId || !loadedRef.current)) {
      toast({
        title: 'Error',
        description: loadError || 'Channel not loaded yet.',
        variant: 'destructive',
      })
      return
    }

    // Step 1: resolve raw document — from form state or imported JSON.
    let rawDocument: Channel
    if (jsonMode === 'json') {
      const trimmed = jsonText.trim()
      if (!trimmed) {
        toast({
          title: 'Error',
          description: 'Paste channel JSON here, or use the Form tab.',
          variant: 'destructive',
        })
        return
      }
      const parsed = parseChannelJson(trimmed)
      if ('error' in parsed) {
        toast({ title: 'Invalid channel', description: parsed.error, variant: 'destructive' })
        return
      }
      rawDocument = channelFromJsonImport(parsed.channel, id)
    } else {
      const uriError = validateFormTabUris()
      if (uriError) {
        toast({ title: 'Invalid URIs', description: uriError, variant: 'destructive' })
        return
      }
      rawDocument = buildChannel()
    }

    // Step 2: route through the single publish pipeline. signedPayload and
    // wireBody come out together so they can't drift.
    const walletDID = ethereumAddressToDIDPKH(getAddress(address))
    const prepared = prepareChannelForPublish({
      rawDocument,
      walletDID,
      base: isEdit ? loadedRef.current ?? undefined : undefined,
    })
    if ('validationErrors' in prepared) {
      toast({
        title: 'Validation Error',
        description: prepared.validationErrors[0],
        variant: 'destructive',
      })
      return
    }
    prepared.toasts.forEach((t) => toast(t))

    // Step 3: sign and POST/PATCH.
    setIsPublishing(true)
    try {
      const signature = await signDocument(prepared.signedBytes, walletClient, 'publisher')
      const body = { ...prepared.wireBody, signatures: [signature] }

      if (isEdit && editId) {
        const updated = await patchChannel(editId, body)
        recordPublishedChannel(address, updated)
        onPublished?.()
        loadedRef.current = updated
        toast({
          title: 'Updated',
          description: (
            <FeedUrlToastDescription
              url={feedChannelResourceUrl(updated.slug?.trim() || updated.id || '')}
            />
          ),
        })
      } else {
        const published = await publishChannel(body as Channel)
        recordPublishedChannel(address, published)
        onPublished?.()
        toast({
          title: 'Success!',
          description: (
            <FeedUrlToastDescription
              url={feedChannelResourceUrl(published.slug?.trim() || published.id || '')}
            />
          ),
        })
        // Reset form (create only)
        setTitle('')
        setSummary('')
        setCoverImage('')
        setPlaylistsText('')
        setUriStatuses([])
        setPublisherName('')
        setPublisherUrl('')
        setCurators([])
        setJsonText('')
        newChannelCreatedRef.current = new Date().toISOString()
      }
    } catch (error) {
      console.error(isEdit ? 'Update failed:' : 'Publish failed:', error)
      toast({
        title: isEdit ? 'Update failed' : 'Publish Failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setIsPublishing(false)
    }
  }

  return (
    <Card className="border-border/45 shadow-[0_2px_40px_-20px_rgba(15,23,42,0.15)]">
      <CardHeader className="space-y-2 pb-6">
        <p className="section-label">Channel</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="font-display text-2xl font-normal sm:text-[1.75rem]">
              {isEdit ? 'Edit channel' : 'New channel'}
            </CardTitle>
            <CardDescription className="text-[15px]">
              {isEdit
                ? 'Edit in the form or JSON tab, then sign to PATCH the feed document.'
                : 'Point to playlists that already exist on the feed, then sign as publisher.'}
            </CardDescription>
          </div>
          {isEdit && onCancelEdit ? (
            <Button
              type="button"
              variant="outline"
              className="shrink-0 gap-2 rounded-full"
              onClick={onCancelEdit}
            >
              <ArrowLeft className="size-4" aria-hidden />
              Back to list
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="pb-8">
        {isLoadingDoc ? (
          <div className="flex items-center gap-3 py-16 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" aria-hidden />
            <span>Loading channel…</span>
          </div>
        ) : loadError ? (
          <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-[15px] text-destructive">
            {loadError}
          </p>
        ) : (
        <Tabs value={jsonMode} onValueChange={(v) => setJsonMode(v as 'form' | 'json')}>
          <TabsList className="mb-2 h-11 w-full max-w-xs rounded-full">
            <TabsTrigger value="form" className="flex-1 rounded-full text-[13px]">
              Form
            </TabsTrigger>
            <TabsTrigger value="json" className="flex-1 rounded-full text-[13px]">
              JSON
            </TabsTrigger>
          </TabsList>

          <TabsContent value="form" className="mt-8 space-y-10">
            {/* Basic Info */}
            <div className="space-y-5">
              <h3 className="section-label">Details</h3>
              <div className="grid gap-4">
                <div>
                  <Label htmlFor="channel-title">Title *</Label>
                  <Input
                    id="channel-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="My Channel"
                  />
                </div>
                <div>
                  <Label htmlFor="channel-slug">Slug</Label>
                  <div className="flex gap-2">
                    <Input
                      id="channel-slug"
                      value={displaySlug}
                      onChange={(e) => {
                        setSlug(e.target.value)
                        setIsAutoSlug(false)
                      }}
                      placeholder="Auto-generated from title"
                    />
                    {!isAutoSlug && (
                      <Button
                        variant="outline"
                        onClick={() => setIsAutoSlug(true)}
                      >
                        Reset
                      </Button>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground/90">
                    Suggested: {autoSlug}
                  </p>
                </div>
                <div>
                  <Label htmlFor="channel-summary">Summary</Label>
                  <Textarea
                    id="channel-summary"
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                    placeholder="Description of your channel"
                    rows={3}
                  />
                </div>
                <div>
                  <Label htmlFor="channel-coverImage">Cover Image URL</Label>
                  <Input
                    id="channel-coverImage"
                    value={coverImage}
                    onChange={(e) => setCoverImage(e.target.value)}
                    placeholder="https://... or ipfs://..."
                  />
                </div>
              </div>
            </div>

            {/* Publisher */}
            <Card className="border-border/40 bg-muted/15 shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="font-sans text-base font-medium tracking-normal">
                  Publisher
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Key (from connected wallet)</Label>
                  <div className="mt-1.5 rounded-xl border border-border/50 bg-background/80 px-3 py-2 font-mono text-xs leading-relaxed text-muted-foreground">
                    {address ? ethereumAddressToDIDPKH(getAddress(address)) : ''}
                  </div>
                </div>
                <div>
                  <Label htmlFor="publisher-name">Name *</Label>
                  <Input
                    id="publisher-name"
                    value={publisherName}
                    onChange={(e) => setPublisherName(e.target.value)}
                    placeholder="Publisher name"
                  />
                </div>
                <div>
                  <Label htmlFor="publisher-url">URL</Label>
                  <Input
                    id="publisher-url"
                    value={publisherUrl}
                    onChange={(e) => setPublisherUrl(e.target.value)}
                    placeholder="https://... (optional)"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Curators (Optional) */}
            {curators.length > 0 ? (
              <CuratorList curators={curators} onChange={setCurators} />
            ) : (
              <Button
                onClick={() => setCurators([{ name: '', key: '', url: '' }])}
                variant="outline"
                className="w-full rounded-full border-dashed"
              >
                Add curators (optional)
              </Button>
            )}

            {/* Playlist URIs */}
            <div className="space-y-5">
              <h3 className="section-label">Playlist URLs</h3>
              {isDebugMode() && (
                <p className="text-xs text-amber-800 dark:text-amber-200/90">
                  Debug mode: http and local playlist URLs are allowed.
                </p>
              )}
              <div>
                <Label htmlFor="playlists">Playlist URIs (one per line) *</Label>
                <Textarea
                  id="playlists"
                  value={playlistsText}
                  onChange={(e) => setPlaylistsText(e.target.value)}
                  placeholder="https://feed.feralfile.com/api/v1/playlists/..."
                  rows={6}
                  className="font-mono text-[13px] leading-relaxed"
                />
              </div>

              <Button onClick={handleValidateURIs} variant="outline" className="rounded-full">
                Check URLs
              </Button>

              {/* URI Status Display */}
              {uriStatuses.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-[13px] font-medium text-muted-foreground">Results</h4>
                  {uriStatuses.map((status, index) => (
                    <div
                      key={index}
                      className="flex items-start gap-3 rounded-xl border border-border/50 bg-background/50 px-3 py-2.5"
                    >
                      <span className="mt-0.5 shrink-0 text-muted-foreground">
                        {!status.valid ? (
                          <MinusCircle className="size-4 text-destructive" aria-hidden />
                        ) : (
                          <Check className="size-4 text-foreground/70" aria-hidden />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-[13px] text-foreground">{status.uri}</p>
                        {!status.valid && status.reason && (
                          <p className="mt-1 text-xs text-destructive">{status.reason}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-col-reverse gap-3 border-t border-border/50 pt-8 sm:flex-row sm:justify-end">
              <Button variant="outline" className="rounded-full" onClick={handleGenerateJSON}>
                Preview JSON
              </Button>
              <Button
                className="rounded-full px-8"
                onClick={handlePublish}
                disabled={isPublishing}
              >
                {isPublishing
                  ? isEdit
                    ? 'Saving…'
                    : 'Publishing…'
                  : isEdit
                    ? 'Sign & update'
                    : 'Sign & publish'}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="json" className="mt-8">
            <div className="space-y-6">
              <JsonFileDropZone
                value={jsonText}
                onChange={handleJsonTextChange}
                rows={20}
              />
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button
                  variant="outline"
                  className="rounded-full"
                  onClick={() => setJsonMode('form')}
                >
                  Back to form
                </Button>
                <Button
                  className="rounded-full px-8"
                  onClick={handlePublish}
                  disabled={isPublishing}
                >
                  {isPublishing
                    ? isEdit
                      ? 'Saving…'
                      : 'Publishing…'
                    : isEdit
                      ? 'Sign & update'
                      : 'Sign & publish'}
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
        )}
      </CardContent>
    </Card>
  )
}
