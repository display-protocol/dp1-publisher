import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useAccount, useWalletClient } from 'wagmi'
import { v4 as uuidv4 } from 'uuid'
import { getAddress } from 'viem'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { generateSlug } from '@/lib/utils'
import { ethereumAddressToDIDPKH } from '@/lib/signing'
import { signDocument, stripSignatureFields } from '@/lib/signing'
import { getPlaylist, patchPlaylist, publishPlaylist } from '@/lib/api'
import { mergePlaylistForPatch } from '@/lib/dp1Merge'
import { recordPublishedPlaylist } from '@/lib/publishedStorage'
import type { Playlist, Entity, PlaylistItem } from '@/types/dp1'
import PlaylistItemForm from './PlaylistItemForm'
import CuratorList from './CuratorList'

function parsePlaylistJson(text: string): { playlist: Playlist } | { error: string } {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { error: 'Not valid JSON.' }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { error: 'Playlist must be a JSON object.' }
  }
  const o = data as Record<string, unknown>
  const title = typeof o.title === 'string' ? o.title.trim() : ''
  if (!title) {
    return { error: 'Title is required.' }
  }
  if (!Array.isArray(o.items)) {
    return { error: 'Property "items" must be an array.' }
  }
  if (o.items.length === 0) {
    return { error: 'At least one item with a source URI is required.' }
  }
  for (let i = 0; i < o.items.length; i++) {
    const it = o.items[i]
    if (!it || typeof it !== 'object') {
      return { error: `items[${i}] must be an object.` }
    }
    const src =
      typeof (it as PlaylistItem).source === 'string'
        ? (it as PlaylistItem).source.trim()
        : ''
    if (!src) {
      return { error: `items[${i}].source is required.` }
    }
  }
  return { playlist: data as Playlist }
}

/** Unsigned playlist ready to sign (no prior signatures). */
function playlistFromJsonImport(raw: Playlist, fallbackId: string): Playlist {
  const { signatures: _s, signature: _legacy, ...rest } = raw as Playlist & {
    signature?: string
  }
  const created =
    typeof rest.created === 'string' && rest.created.trim() !== ''
      ? rest.created
      : new Date().toISOString()
  return {
    ...rest,
    dpVersion: rest.dpVersion || '1.1.0',
    id: rest.id || fallbackId,
    created,
    items: rest.items.map((item) => ({
      ...item,
      id: item.id || uuidv4(),
      source: typeof item.source === 'string' ? item.source.trim() : item.source,
    })),
  }
}

export default function PlaylistForm({
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

  const loadedRef = useRef<Playlist | null>(null)
  const [id, setId] = useState(() => uuidv4())
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoadingDoc, setIsLoadingDoc] = useState(false)
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [isAutoSlug, setIsAutoSlug] = useState(true)
  const [summary, setSummary] = useState('')
  const [coverImage, setCoverImage] = useState('')
  
  // Curators (first one is always the connected wallet)
  const [curators, setCurators] = useState<Entity[]>([
    { name: '', key: address ? ethereumAddressToDIDPKH(getAddress(address)) : '', url: '' }
  ])

  // Default settings
  const [defaultScaling, setDefaultScaling] = useState<'fit' | 'fill' | 'stretch' | 'auto'>('fit')
  const [defaultLicense, setDefaultLicense] = useState<'open' | 'token' | 'subscription'>('open')
  const [defaultDuration, setDefaultDuration] = useState('')
  const [defaultAutoplay, setDefaultAutoplay] = useState(true)
  const [defaultLoop, setDefaultLoop] = useState(true)
  const [defaultBackground, setDefaultBackground] = useState('#000000')

  // Playlist items
  const [items, setItems] = useState<PlaylistItem[]>([
    { source: '', title: '', duration: undefined, license: undefined }
  ])

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
    const kid = ethereumAddressToDIDPKH(getAddress(address))
    getPlaylist(editId)
      .then((p) => {
        if (cancelled) return
        loadedRef.current = p
        setId(p.id || uuidv4())
        setTitle(p.title)
        setIsAutoSlug(false)
        setSlug(p.slug || '')
        setSummary(p.summary || '')
        setCoverImage(p.coverImage || '')
        setCurators(
          p.curators?.length
            ? p.curators
            : [{ name: '', key: kid, url: '' }]
        )
        const d = p.defaults?.display
        setDefaultScaling(d?.scaling ?? 'fit')
        setDefaultLicense(p.defaults?.license ?? 'open')
        setDefaultDuration(
          p.defaults?.duration != null ? String(p.defaults.duration) : ''
        )
        setDefaultAutoplay(d?.autoplay ?? true)
        setDefaultLoop(d?.loop ?? true)
        setDefaultBackground(
          typeof d?.background === 'string' ? d.background : '#000000'
        )
        setItems(
          p.items?.length
            ? p.items.map((it) => ({
                ...it,
                id: it.id || uuidv4(),
              }))
            : [{ source: '', title: '', duration: undefined, license: undefined }]
        )
        setJsonText(JSON.stringify(stripSignatureFields(p as object), null, 2))
        setJsonMode('form')
      })
      .catch((e) => {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : 'Failed to load playlist')
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
  const autoSlug = generateSlug(title, id)
  const displaySlug = isAutoSlug ? autoSlug : slug

  const handleAddItem = () => {
    setItems([...items, { source: '', title: '', duration: undefined, license: undefined }])
  }

  const handleRemoveItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index))
    }
  }

  const handleUpdateItem = (index: number, item: PlaylistItem) => {
    const newItems = [...items]
    newItems[index] = item
    setItems(newItems)
  }

  const buildPlaylist = (): Playlist => {
    const created = new Date().toISOString()
    
    return {
      dpVersion: '1.1.0',
      id,
      slug: displaySlug,
      title,
      created,
      items: items.map(item => ({
        ...item,
        id: item.id || uuidv4()
      })),
      curators,
      summary: summary || undefined,
      coverImage: coverImage || undefined,
      defaults: {
        display: {
          scaling: defaultScaling,
          autoplay: defaultAutoplay,
          loop: defaultLoop,
          background: defaultBackground,
        },
        license: defaultLicense,
        duration: defaultDuration ? parseFloat(defaultDuration) : undefined,
      },
    }
  }

  const handleGenerateJSON = () => {
    if (isEdit && loadedRef.current) {
      const base = loadedRef.current
      const patchFields = {
        dpVersion: '1.1.0',
        title: title.trim(),
        slug: displaySlug,
        items: items.map((item) => ({
          ...item,
          id: item.id || uuidv4(),
        })),
        curators,
        summary: summary.trim() || undefined,
        coverImage: coverImage.trim() || undefined,
        defaults: {
          display: {
            scaling: defaultScaling,
            autoplay: defaultAutoplay,
            loop: defaultLoop,
            background: defaultBackground,
          },
          license: defaultLicense,
          duration: defaultDuration ? parseFloat(defaultDuration) : undefined,
        },
      }
      const merged = mergePlaylistForPatch(base, patchFields)
      setJsonText(JSON.stringify(stripSignatureFields(merged as object), null, 2))
    } else {
      const playlist = buildPlaylist()
      setJsonText(JSON.stringify(playlist, null, 2))
    }
    setJsonMode('json')
  }

  const handlePublish = async () => {
    if (!walletClient || !address) {
      toast({ title: 'Error', description: 'Wallet not connected', variant: 'destructive' })
      return
    }

    if (isEdit) {
      if (!editId || !loadedRef.current) {
        toast({
          title: 'Error',
          description: loadError || 'Playlist not loaded yet.',
          variant: 'destructive',
        })
        return
      }

      const base = loadedRef.current

      let patchFields: Parameters<typeof mergePlaylistForPatch>[1]

      if (jsonMode === 'json') {
        const trimmed = jsonText.trim()
        if (!trimmed) {
          toast({
            title: 'Error',
            description: 'Paste playlist JSON here, or use the Form tab.',
            variant: 'destructive',
          })
          return
        }
        const parsed = parsePlaylistJson(trimmed)
        if ('error' in parsed) {
          toast({ title: 'Invalid playlist', description: parsed.error, variant: 'destructive' })
          return
        }
        const p = parsed.playlist
        patchFields = {
          dpVersion: p.dpVersion || base.dpVersion || '1.1.0',
          title: p.title.trim(),
          slug: p.slug ?? base.slug ?? '',
          items: p.items.map((item) => ({
            ...item,
            id: item.id || uuidv4(),
            source: typeof item.source === 'string' ? item.source.trim() : item.source,
          })),
          curators: p.curators ?? base.curators,
          summary: p.summary,
          coverImage: p.coverImage,
          defaults: p.defaults,
          dynamicQuery: p.dynamicQuery as Record<string, unknown> | undefined,
        }
      } else {
        if (!title.trim()) {
          toast({ title: 'Error', description: 'Title is required', variant: 'destructive' })
          return
        }
        if (items.length === 0 || items.some((item) => !item.source)) {
          toast({
            title: 'Error',
            description: 'At least one item with source URI is required',
            variant: 'destructive',
          })
          return
        }

        patchFields = {
          dpVersion: '1.1.0',
          title: title.trim(),
          slug: displaySlug,
          items: items.map((item) => ({
            ...item,
            id: item.id || uuidv4(),
          })),
          curators,
          summary: summary.trim() || undefined,
          coverImage: coverImage.trim() || undefined,
          defaults: {
            display: {
              scaling: defaultScaling,
              autoplay: defaultAutoplay,
              loop: defaultLoop,
              background: defaultBackground,
            },
            license: defaultLicense,
            duration: defaultDuration ? parseFloat(defaultDuration) : undefined,
          },
        }
      }

      const merged = mergePlaylistForPatch(base, patchFields)
      setIsPublishing(true)
      try {
        const signature = await signDocument(
          stripSignatureFields(merged) as object,
          walletClient,
          'curator'
        )
        const body: Record<string, unknown> = {
          dpVersion: patchFields.dpVersion,
          title: patchFields.title,
          slug: patchFields.slug,
          items: patchFields.items,
          curators: patchFields.curators,
          signatures: [signature],
        }
        if (patchFields.summary !== undefined) body.summary = patchFields.summary
        if (patchFields.coverImage !== undefined) body.coverImage = patchFields.coverImage
        if (patchFields.defaults) body.defaults = patchFields.defaults
        if (patchFields.dynamicQuery !== undefined) body.dynamicQuery = patchFields.dynamicQuery

        const updated = await patchPlaylist(editId, body)
        recordPublishedPlaylist(address, updated)
        onPublished?.()
        loadedRef.current = updated
        toast({
          title: 'Updated',
          description: `Playlist saved: ${updated.slug}`,
        })
      } catch (error) {
        console.error('Update failed:', error)
        toast({
          title: 'Update failed',
          description: error instanceof Error ? error.message : 'Unknown error',
          variant: 'destructive',
        })
      } finally {
        setIsPublishing(false)
      }
      return
    }

    let unsignedPlaylist: Playlist

    if (jsonMode === 'json') {
      const trimmed = jsonText.trim()
      if (!trimmed) {
        toast({
          title: 'Error',
          description: 'Paste playlist JSON here, or use the Form tab.',
          variant: 'destructive',
        })
        return
      }
      const parsed = parsePlaylistJson(trimmed)
      if ('error' in parsed) {
        toast({ title: 'Invalid playlist', description: parsed.error, variant: 'destructive' })
        return
      }
      unsignedPlaylist = playlistFromJsonImport(parsed.playlist, id)
    } else {
      if (!title.trim()) {
        toast({ title: 'Error', description: 'Title is required', variant: 'destructive' })
        return
      }

      if (items.length === 0 || items.some((item) => !item.source)) {
        toast({
          title: 'Error',
          description: 'At least one item with source URI is required',
          variant: 'destructive',
        })
        return
      }

      unsignedPlaylist = buildPlaylist()
    }

    setIsPublishing(true)

    try {

      // Sign the playlist
      const signature = await signDocument(unsignedPlaylist, walletClient, 'curator')

      // Add signature
      const signedPlaylist: Playlist = {
        ...unsignedPlaylist,
        signatures: [signature]
      }

      // Publish to feed server
      const published = await publishPlaylist(signedPlaylist)
      recordPublishedPlaylist(address, published)
      onPublished?.()

      toast({
        title: 'Success!',
        description: `Playlist published: ${published.slug}`,
      })

      // Reset form
      setTitle('')
      setSummary('')
      setCoverImage('')
      setJsonText('')
      setItems([{ source: '', title: '', duration: undefined, license: undefined }])
      
    } catch (error) {
      console.error('Publish failed:', error)
      toast({
        title: 'Publish Failed',
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
        <p className="section-label">Playlist</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="font-display text-2xl font-normal sm:text-[1.75rem]">
              {isEdit ? 'Edit playlist' : 'New playlist'}
            </CardTitle>
            <CardDescription className="text-[15px]">
              {isEdit
                ? 'Edit in the form or JSON tab, then sign to PATCH the feed document.'
                : 'Build fields below or switch to JSON to paste a document.'}
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
            <span>Loading playlist…</span>
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
                  <Label htmlFor="title">Title *</Label>
                  <Input
                    id="title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="My Awesome Playlist"
                  />
                </div>
                <div>
                  <Label htmlFor="slug">Slug</Label>
                  <div className="flex gap-2">
                    <Input
                      id="slug"
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
                  <Label htmlFor="summary">Summary</Label>
                  <Textarea
                    id="summary"
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                    placeholder="Description of your playlist"
                    rows={3}
                  />
                </div>
                <div>
                  <Label htmlFor="coverImage">Cover Image URL</Label>
                  <Input
                    id="coverImage"
                    value={coverImage}
                    onChange={(e) => setCoverImage(e.target.value)}
                    placeholder="https://... or ipfs://..."
                  />
                </div>
              </div>
            </div>

            {/* Curators */}
            <CuratorList curators={curators} onChange={setCurators} />

            {/* Default Settings */}
            <div className="space-y-5">
              <h3 className="section-label">Defaults</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="scaling">Scaling</Label>
                  <Select
                    value={defaultScaling}
                    onValueChange={(v: 'fit' | 'fill' | 'stretch' | 'auto') =>
                      setDefaultScaling(v)
                    }
                  >
                    <SelectTrigger id="scaling">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fit">Fit</SelectItem>
                      <SelectItem value="fill">Fill</SelectItem>
                      <SelectItem value="stretch">Stretch</SelectItem>
                      <SelectItem value="auto">Auto</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="license">License</Label>
                  <Select
                    value={defaultLicense}
                    onValueChange={(v: 'open' | 'token' | 'subscription') =>
                      setDefaultLicense(v)
                    }
                  >
                    <SelectTrigger id="license">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="token">Token</SelectItem>
                      <SelectItem value="subscription">Subscription</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="duration">Duration (seconds)</Label>
                  <Input
                    id="duration"
                    type="number"
                    value={defaultDuration}
                    onChange={(e) => setDefaultDuration(e.target.value)}
                    placeholder="20"
                  />
                </div>
                <div>
                  <Label htmlFor="background">Background</Label>
                  <Input
                    id="background"
                    value={defaultBackground}
                    onChange={(e) => setDefaultBackground(e.target.value)}
                    placeholder="#000000"
                  />
                </div>
                <div className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    id="autoplay"
                    checked={defaultAutoplay}
                    onChange={(e) => setDefaultAutoplay(e.target.checked)}
                    className="size-4 rounded border-border accent-foreground"
                  />
                  <Label htmlFor="autoplay">Autoplay</Label>
                </div>
                <div className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    id="loop"
                    checked={defaultLoop}
                    onChange={(e) => setDefaultLoop(e.target.checked)}
                    className="size-4 rounded border-border accent-foreground"
                  />
                  <Label htmlFor="loop">Loop</Label>
                </div>
              </div>
            </div>

            {/* Items */}
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-4">
                <span className="section-label">
                  Items · {items.length}
                </span>
                <Button
                  onClick={handleAddItem}
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                >
                  Add item
                </Button>
              </div>
              <div className="space-y-3">
                {items.map((item, index) => (
                  <PlaylistItemForm
                    key={index}
                    item={item}
                    index={index}
                    onUpdate={(item: PlaylistItem) => handleUpdateItem(index, item)}
                    onRemove={() => handleRemoveItem(index)}
                    canRemove={items.length > 1}
                  />
                ))}
              </div>
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
              <Textarea
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                rows={20}
                className="font-mono text-[13px] leading-relaxed"
                placeholder="Paste playlist JSON…"
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
