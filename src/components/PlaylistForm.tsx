import { useCallback, useEffect, useRef, useState } from 'react'
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
import { signDocument } from '@/lib/signing'
import { playlistUnsignedPayloadForSigning } from '@/lib/playlistSignPayload'
import { feedPlaylistResourceUrl, getPlaylist, patchPlaylist, publishPlaylist } from '@/lib/api'
import { FeedUrlToastDescription } from '@/components/FeedUrlToastDescription'
import { mergePlaylistForPatch } from '@/lib/dp1Merge'
import { stripPlaylistExtensionFields, stripItemExtensionFields } from '@/lib/dp1ExtensionPolicy'
import { recordPublishedPlaylist } from '@/lib/publishedStorage'
import type { DynamicQuery, Entity, Playlist, PlaylistItem } from '@/types/dp1'
import PlaylistItemForm from './PlaylistItemForm'
import CuratorList from './CuratorList'

function parsePlaylistJson(
  text: string,
  extensionsEnabled: boolean
): { playlist: Playlist } | { error: string } {
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
  // Allow empty items only if dynamicQuery is present (extensions / dynamic playlists)
  if (o.items.length === 0) {
    if (!extensionsEnabled) {
      return { error: 'At least one item with a source URI is required.' }
    }
    if (!o.dynamicQuery) {
      return { error: 'At least one item with a source URI is required, or provide dynamicQuery.' }
    }
  } else {
    // Validate items if present
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
  }
  if (!extensionsEnabled && o.dynamicQuery != null && typeof o.dynamicQuery === 'object') {
    return { error: 'dynamicQuery requires DP-1 extensions (disabled for this publisher).' }
  }
  return { playlist: data as Playlist }
}

/** Lenient parse for live JSON ↔ form sync (publish still uses strict `parsePlaylistJson`). */
function parsePlaylistJsonForFormSync(text: string): Playlist | null {
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
  const titleStr =
    o.title == null ? '' : typeof o.title === 'string' ? o.title : String(o.title)
  if (!Array.isArray(o.items)) {
    return null
  }
  const items: PlaylistItem[] = []
  for (let i = 0; i < o.items.length; i++) {
    const it = o.items[i]
    if (!it || typeof it !== 'object' || Array.isArray(it)) {
      continue
    }
    const row = it as PlaylistItem
    const source =
      typeof row.source === 'string'
        ? row.source
        : row.source != null
          ? String(row.source)
          : ''
    items.push({
      ...row,
      source,
      id: row.id || uuidv4(),
    })
  }
  if (items.length === 0) {
    return {
      ...(data as Playlist),
      title: titleStr,
      items: [{ source: '', title: '', duration: undefined, license: undefined }],
    }
  }
  return { ...(data as Playlist), title: titleStr, items }
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
  extensionsEnabled,
}: {
  editId?: string
  onCancelEdit?: () => void
  onPublished?: () => void
  extensionsEnabled: boolean
}) {
  const { address } = useAccount()
  const { data: walletClient } = useWalletClient()
  const { toast } = useToast()

  const loadedRef = useRef<Playlist | null>(null)
  const newPlaylistCreatedRef = useRef<string>(new Date().toISOString())
  const [id, setId] = useState(() => uuidv4())
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoadingDoc, setIsLoadingDoc] = useState(false)
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [isAutoSlug, setIsAutoSlug] = useState(true)
  const [summary, setSummary] = useState('')
  const [coverImage, setCoverImage] = useState('')
  
  // Playlist-level note (optional intermission)
  const [playlistNoteText, setPlaylistNoteText] = useState('')
  const [playlistNoteDuration, setPlaylistNoteDuration] = useState('')
  
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

  // Dynamic Query (optional, allows empty items)
  const [enableDynamicQuery, setEnableDynamicQuery] = useState(false)
  const [dynamicProfile, setDynamicProfile] = useState<'https-json-v1' | 'graphql-v1'>('https-json-v1')
  const [dynamicEndpoint, setDynamicEndpoint] = useState('')
  const [dynamicMethod, setDynamicMethod] = useState<'GET' | 'POST'>('GET')
  const [dynamicHeaders, setDynamicHeaders] = useState('')
  const [dynamicQuery, setDynamicQuery] = useState('')
  const [dynamicItemsPath, setDynamicItemsPath] = useState('')
  const [dynamicItemSchema, setDynamicItemSchema] = useState('dp1/1.1')
  const [dynamicItemMap, setDynamicItemMap] = useState('')

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
        const pDoc = extensionsEnabled ? p : stripPlaylistExtensionFields(p)
        loadedRef.current = pDoc
        setId(pDoc.id || uuidv4())
        setTitle(pDoc.title)
        setIsAutoSlug(false)
        setSlug(pDoc.slug || '')
        setSummary(pDoc.summary || '')
        setCoverImage(pDoc.coverImage || '')
        // Load playlist-level note
        setPlaylistNoteText(pDoc.note?.text || '')
        setPlaylistNoteDuration(pDoc.note?.duration != null ? String(pDoc.note.duration) : '')
        setCurators(
          pDoc.curators?.length
            ? pDoc.curators
            : [{ name: '', key: kid, url: '' }]
        )
        const d = pDoc.defaults?.display
        setDefaultScaling(d?.scaling ?? 'fit')
        setDefaultLicense(pDoc.defaults?.license ?? 'open')
        setDefaultDuration(
          pDoc.defaults?.duration != null ? String(pDoc.defaults.duration) : ''
        )
        setDefaultAutoplay(d?.autoplay ?? true)
        setDefaultLoop(d?.loop ?? true)
        setDefaultBackground(
          typeof d?.background === 'string' ? d.background : '#000000'
        )
        setItems(
          pDoc.items?.length
            ? pDoc.items.map((it) => ({
                ...it,
                id: it.id || uuidv4(),
              }))
            : [{ source: '', title: '', duration: undefined, license: undefined }]
        )
        // Load dynamicQuery if present
        if (pDoc.dynamicQuery) {
          setEnableDynamicQuery(true)
          setDynamicProfile(pDoc.dynamicQuery.profile || 'https-json-v1')
          setDynamicEndpoint(pDoc.dynamicQuery.endpoint || '')
          setDynamicMethod(pDoc.dynamicQuery.method || 'GET')
          setDynamicHeaders(pDoc.dynamicQuery.headers ? JSON.stringify(pDoc.dynamicQuery.headers, null, 2) : '')
          setDynamicQuery(pDoc.dynamicQuery.query || '')
          setDynamicItemsPath(pDoc.dynamicQuery.responseMapping?.itemsPath || '')
          setDynamicItemSchema(pDoc.dynamicQuery.responseMapping?.itemSchema || 'dp1/1.1')
          setDynamicItemMap(pDoc.dynamicQuery.responseMapping?.itemMap ? JSON.stringify(pDoc.dynamicQuery.responseMapping.itemMap, null, 2) : '')
        } else {
          setEnableDynamicQuery(false)
        }
        setJsonText(JSON.stringify(playlistUnsignedPayloadForSigning(pDoc), null, 2))
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
  }, [editId, address, extensionsEnabled])

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

  const buildDynamicQuery = useCallback((): DynamicQuery | undefined => {
    if (!enableDynamicQuery) return undefined
    if (!dynamicEndpoint.trim() || !dynamicItemsPath.trim()) return undefined

    try {
      const headers = dynamicHeaders.trim() ? 
        (JSON.parse(dynamicHeaders) as Record<string, string>) : undefined
      const itemMap = dynamicItemMap.trim() ? 
        (JSON.parse(dynamicItemMap) as Record<string, string>) : undefined

      return {
        profile: dynamicProfile,
        endpoint: dynamicEndpoint.trim(),
        method: dynamicMethod,
        headers,
        query: dynamicQuery.trim() || undefined,
        responseMapping: {
          itemsPath: dynamicItemsPath.trim(),
          itemSchema: dynamicItemSchema.trim(),
          itemMap,
        },
      }
    } catch (error) {
      console.error('Failed to build dynamic query:', error)
      return undefined
    }
  }, [
    enableDynamicQuery,
    dynamicProfile,
    dynamicEndpoint,
    dynamicMethod,
    dynamicHeaders,
    dynamicQuery,
    dynamicItemsPath,
    dynamicItemSchema,
    dynamicItemMap,
  ])

  const buildPlaylist = useCallback((): Playlist => {
    const created = newPlaylistCreatedRef.current
    const dq = extensionsEnabled ? buildDynamicQuery() : undefined

    const note =
      extensionsEnabled && playlistNoteText.trim()
        ? {
            text: playlistNoteText.trim(),
            duration: playlistNoteDuration ? parseFloat(playlistNoteDuration) : undefined,
          }
        : undefined

    const mappedItems = items.map((item) => {
      const base = extensionsEnabled ? item : stripItemExtensionFields(item)
      return {
        ...base,
        id: base.id || uuidv4(),
      }
    })

    return {
      dpVersion: '1.1.0',
      id,
      slug: displaySlug,
      title,
      created,
      items: mappedItems,
      ...(extensionsEnabled
        ? {
            curators,
            summary: summary || undefined,
            coverImage: coverImage || undefined,
            dynamicQuery: dq,
            note,
          }
        : {}),
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
  }, [
    id,
    displaySlug,
    title,
    items,
    curators,
    summary,
    coverImage,
    buildDynamicQuery,
    playlistNoteText,
    playlistNoteDuration,
    defaultScaling,
    defaultAutoplay,
    defaultLoop,
    defaultBackground,
    defaultLicense,
    defaultDuration,
    extensionsEnabled,
  ])

  const serializePlaylistJsonPreview = useCallback((): string => {
    if (isEdit && loadedRef.current) {
      const base = loadedRef.current
      const dq = extensionsEnabled ? buildDynamicQuery() : undefined
      const note =
        extensionsEnabled && playlistNoteText.trim()
          ? {
              text: playlistNoteText.trim(),
              duration: playlistNoteDuration ? parseFloat(playlistNoteDuration) : undefined,
            }
          : undefined

      const mappedItems = items.map((item) => {
        const it = extensionsEnabled ? item : stripItemExtensionFields(item)
        return { ...it, id: item.id || uuidv4() }
      })

      const patchFields = {
        dpVersion: '1.1.0',
        title: title.trim(),
        slug: displaySlug,
        items: mappedItems,
        ...(extensionsEnabled
          ? {
              curators,
              summary: summary.trim() || undefined,
              coverImage: coverImage.trim() || undefined,
              dynamicQuery: dq,
              note,
            }
          : {}),
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
      const toSign = extensionsEnabled ? merged : stripPlaylistExtensionFields(merged)
      return JSON.stringify(playlistUnsignedPayloadForSigning(toSign), null, 2)
    }
    const playlist = buildPlaylist()
    const toSign = extensionsEnabled ? playlist : stripPlaylistExtensionFields(playlist)
    return JSON.stringify(playlistUnsignedPayloadForSigning(toSign), null, 2)
  }, [
    isEdit,
    title,
    displaySlug,
    items,
    curators,
    summary,
    coverImage,
    buildDynamicQuery,
    playlistNoteText,
    playlistNoteDuration,
    defaultScaling,
    defaultAutoplay,
    defaultLoop,
    defaultBackground,
    defaultLicense,
    defaultDuration,
    buildPlaylist,
    extensionsEnabled,
  ])

  const applyParsedPlaylistToForm = useCallback(
    (raw: Playlist) => {
      const p = playlistFromJsonImport(raw, id)
      const kid = address ? ethereumAddressToDIDPKH(getAddress(address)) : ''
      if (!isEdit && p.created?.trim()) {
        newPlaylistCreatedRef.current = p.created.trim()
      }
      setId(p.id || id)
      const resolvedId = p.id || id
      setTitle(p.title)
      const auto = generateSlug(p.title, resolvedId)
      if (!p.slug?.trim() || p.slug.trim() === auto) {
        setIsAutoSlug(true)
        setSlug('')
      } else {
        setIsAutoSlug(false)
        setSlug(p.slug.trim())
      }
      setSummary(p.summary || '')
      setCoverImage(p.coverImage || '')
      setCurators(
        p.curators?.length ? p.curators : [{ name: '', key: kid, url: '' }]
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
      // Load dynamicQuery if present
      if (p.dynamicQuery) {
        setEnableDynamicQuery(true)
        setDynamicProfile(p.dynamicQuery.profile || 'https-json-v1')
        setDynamicEndpoint(p.dynamicQuery.endpoint || '')
        setDynamicMethod(p.dynamicQuery.method || 'GET')
        setDynamicHeaders(p.dynamicQuery.headers ? JSON.stringify(p.dynamicQuery.headers, null, 2) : '')
        setDynamicQuery(p.dynamicQuery.query || '')
        setDynamicItemsPath(p.dynamicQuery.responseMapping?.itemsPath || '')
        setDynamicItemSchema(p.dynamicQuery.responseMapping?.itemSchema || 'dp1/1.1')
        setDynamicItemMap(p.dynamicQuery.responseMapping?.itemMap ? JSON.stringify(p.dynamicQuery.responseMapping.itemMap, null, 2) : '')
      } else {
        setEnableDynamicQuery(false)
      }
      // Load playlist-level note
      setPlaylistNoteText(p.note?.text || '')
      setPlaylistNoteDuration(p.note?.duration != null ? String(p.note.duration) : '')
    },
    [id, isEdit, address]
  )

  const handleJsonTextChange = (value: string) => {
    setJsonText(value)
    const trimmed = value.trim()
    if (!trimmed) {
      return
    }
    const playlist = parsePlaylistJsonForFormSync(trimmed)
    if (!playlist) {
      return
    }
    applyParsedPlaylistToForm(playlist)
  }

  useEffect(() => {
    if (jsonMode !== 'form' || isLoadingDoc) {
      return
    }
    if (isEdit && !loadedRef.current) {
      return
    }
    setJsonText(serializePlaylistJsonPreview())
  }, [jsonMode, isLoadingDoc, isEdit, serializePlaylistJsonPreview])

  const handleGenerateJSON = () => {
    setJsonText(serializePlaylistJsonPreview())
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
        const parsed = parsePlaylistJson(trimmed, extensionsEnabled)
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
          dynamicQuery: p.dynamicQuery,
          note: p.note,
        }
      } else {
        if (!title.trim()) {
          toast({ title: 'Error', description: 'Title is required', variant: 'destructive' })
          return
        }
        const allowEmptyViaDynamic = extensionsEnabled && enableDynamicQuery
        if (!allowEmptyViaDynamic && (items.length === 0 || items.some((item) => !item.source))) {
          toast({
            title: 'Error',
            description: extensionsEnabled
              ? 'At least one item with source URI is required, or enable Dynamic Query'
              : 'At least one item with source URI is required',
            variant: 'destructive',
          })
          return
        }
        if (extensionsEnabled && enableDynamicQuery) {
          if (!dynamicEndpoint.trim()) {
            toast({ title: 'Error', description: 'Dynamic Query: Endpoint is required', variant: 'destructive' })
            return
          }
          if (!dynamicItemsPath.trim()) {
            toast({ title: 'Error', description: 'Dynamic Query: Items Path is required', variant: 'destructive' })
            return
          }
          if (dynamicHeaders.trim()) {
            try {
              JSON.parse(dynamicHeaders)
            } catch {
              toast({ title: 'Error', description: 'Dynamic Query: Headers must be valid JSON', variant: 'destructive' })
              return
            }
          }
          if (dynamicItemMap.trim()) {
            try {
              JSON.parse(dynamicItemMap)
            } catch {
              toast({ title: 'Error', description: 'Dynamic Query: Item Map must be valid JSON', variant: 'destructive' })
              return
            }
          }
        }

        const dq = extensionsEnabled ? buildDynamicQuery() : undefined
        const note =
          extensionsEnabled && playlistNoteText.trim()
            ? {
                text: playlistNoteText.trim(),
                duration: playlistNoteDuration ? parseFloat(playlistNoteDuration) : undefined,
              }
            : undefined

        const mappedItems = items.map((item) => {
          const baseItem = extensionsEnabled ? item : stripItemExtensionFields(item)
          return {
            ...baseItem,
            id: item.id || uuidv4(),
            source: typeof item.source === 'string' ? item.source.trim() : item.source,
          }
        })

        patchFields = {
          dpVersion: '1.1.0',
          title: title.trim(),
          slug: displaySlug,
          items: mappedItems,
          ...(extensionsEnabled
            ? {
                curators,
                summary: summary.trim() || undefined,
                coverImage: coverImage.trim() || undefined,
                dynamicQuery: dq,
                note,
              }
            : {}),
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
      const canon = extensionsEnabled ? merged : stripPlaylistExtensionFields(merged)
      setIsPublishing(true)
      try {
        const signature = await signDocument(
          playlistUnsignedPayloadForSigning(canon),
          walletClient,
          'curator'
        )
        const body: Record<string, unknown> = {
          dpVersion: canon.dpVersion,
          title: canon.title,
          slug: canon.slug ?? '',
          items: canon.items,
          signatures: [signature],
        }
        if (canon.defaults !== undefined) body.defaults = canon.defaults
        if (extensionsEnabled) {
          if (canon.curators && canon.curators.length > 0) {
            body.curators = canon.curators
          }
          if (canon.summary !== undefined) body.summary = canon.summary
          if (canon.coverImage !== undefined) body.coverImage = canon.coverImage
          if (canon.dynamicQuery !== undefined) body.dynamicQuery = canon.dynamicQuery
          if (canon.note !== undefined) body.note = canon.note
        }

        const updated = await patchPlaylist(editId, body)
        recordPublishedPlaylist(address, updated)
        onPublished?.()
        loadedRef.current = updated
        toast({
          title: 'Updated',
          description: (
            <FeedUrlToastDescription
              url={feedPlaylistResourceUrl(updated.slug?.trim() || updated.id || '')}
            />
          ),
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
      const parsed = parsePlaylistJson(trimmed, extensionsEnabled)
      if ('error' in parsed) {
        toast({ title: 'Invalid playlist', description: parsed.error, variant: 'destructive' })
        return
      }
      unsignedPlaylist = playlistFromJsonImport(parsed.playlist, id)
      if (!extensionsEnabled) {
        unsignedPlaylist = stripPlaylistExtensionFields(unsignedPlaylist)
      }
    } else {
      if (!title.trim()) {
        toast({ title: 'Error', description: 'Title is required', variant: 'destructive' })
        return
      }

      const allowEmptyViaDynamic = extensionsEnabled && enableDynamicQuery
      if (!allowEmptyViaDynamic && (items.length === 0 || items.some((item) => !item.source))) {
        toast({
          title: 'Error',
          description: extensionsEnabled
            ? 'At least one item with source URI is required, or enable Dynamic Query'
            : 'At least one item with source URI is required',
          variant: 'destructive',
        })
        return
      }
      if (extensionsEnabled && enableDynamicQuery) {
        if (!dynamicEndpoint.trim()) {
          toast({ title: 'Error', description: 'Dynamic Query: Endpoint is required', variant: 'destructive' })
          return
        }
        if (!dynamicItemsPath.trim()) {
          toast({ title: 'Error', description: 'Dynamic Query: Items Path is required', variant: 'destructive' })
          return
        }
        if (dynamicHeaders.trim()) {
          try {
            JSON.parse(dynamicHeaders)
          } catch {
            toast({ title: 'Error', description: 'Dynamic Query: Headers must be valid JSON', variant: 'destructive' })
            return
          }
        }
        if (dynamicItemMap.trim()) {
          try {
            JSON.parse(dynamicItemMap)
          } catch {
            toast({ title: 'Error', description: 'Dynamic Query: Item Map must be valid JSON', variant: 'destructive' })
            return
          }
        }
      }

      unsignedPlaylist = buildPlaylist()
    }

    const canonPlaylist = extensionsEnabled
      ? unsignedPlaylist
      : stripPlaylistExtensionFields(unsignedPlaylist)

    setIsPublishing(true)

    try {
      const wire = playlistUnsignedPayloadForSigning(canonPlaylist)
      const signature = await signDocument(wire, walletClient, 'curator')

      const signedPlaylist = {
        ...wire,
        signatures: [signature],
      } as Playlist

      const published = await publishPlaylist(signedPlaylist)
      recordPublishedPlaylist(address, published)
      onPublished?.()

      toast({
        title: 'Success!',
        description: (
          <FeedUrlToastDescription
            url={feedPlaylistResourceUrl(published.slug?.trim() || published.id || '')}
          />
        ),
      })

      // Reset form
      setTitle('')
      setSummary('')
      setCoverImage('')
      setPlaylistNoteText('')
      setPlaylistNoteDuration('')
      setJsonText('')
      newPlaylistCreatedRef.current = new Date().toISOString()
      setItems([{ source: '', title: '', duration: undefined, license: undefined }])
      setEnableDynamicQuery(false)
      setDynamicProfile('https-json-v1')
      setDynamicEndpoint('')
      setDynamicMethod('GET')
      setDynamicHeaders('')
      setDynamicQuery('')
      setDynamicItemsPath('')
      setDynamicItemSchema('dp1/1.1')
      setDynamicItemMap('')
      
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
                : extensionsEnabled
                  ? 'Build fields below or switch to JSON to paste a document.'
                  : 'Core playlist fields only (extensions off for this deployment). Switch to JSON to paste core-only DP-1 JSON.'}
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
                {extensionsEnabled ? (
                  <>
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
                  </>
                ) : null}
              </div>
            </div>

            {/* Playlist Note — playlists extension */}
            {extensionsEnabled ? (
            <div className="space-y-5">
              <h3 className="section-label">Intermission Note (Optional)</h3>
              <p className="text-sm text-muted-foreground">
                Optional intermission card displayed before playlist starts. Short artist-authored text.
              </p>
              <div className="grid gap-4">
                <div>
                  <Label htmlFor="playlistNoteText">Note Text</Label>
                  <Textarea
                    id="playlistNoteText"
                    value={playlistNoteText}
                    onChange={(e) => setPlaylistNoteText(e.target.value)}
                    placeholder="A short message or interlude (max 500 characters)"
                    rows={3}
                    maxLength={500}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {playlistNoteText.length}/500 characters
                  </p>
                </div>
                <div>
                  <Label htmlFor="playlistNoteDuration">Duration (seconds)</Label>
                  <Input
                    id="playlistNoteDuration"
                    type="number"
                    value={playlistNoteDuration}
                    onChange={(e) => setPlaylistNoteDuration(e.target.value)}
                    placeholder="20 (default)"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    How long to show the note before continuing. Defaults to 20 seconds.
                  </p>
                </div>
              </div>
            </div>
            ) : null}

            {/* Curators — playlists extension */}
            {extensionsEnabled ? <CuratorList curators={curators} onChange={setCurators} /> : null}

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
                    showIntermissionNote={extensionsEnabled}
                    onUpdate={(item: PlaylistItem) => handleUpdateItem(index, item)}
                    onRemove={() => handleRemoveItem(index)}
                    canRemove={items.length > 1}
                  />
                ))}
              </div>
            </div>

            {extensionsEnabled ? (
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-4">
                <span className="section-label">Dynamic Query (Optional)</span>
                <div className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    id="enableDynamicQuery"
                    checked={enableDynamicQuery}
                    onChange={(e) => setEnableDynamicQuery(e.target.checked)}
                    className="size-4 rounded border-border accent-foreground"
                  />
                  <Label htmlFor="enableDynamicQuery">Enable</Label>
                </div>
              </div>
              {enableDynamicQuery && (
                <div className="space-y-4 rounded-xl border border-border/50 bg-muted/30 p-5">
                  <p className="text-sm text-muted-foreground">
                    Configure dynamic item fetching from external indexers. When enabled, items can be empty.
                  </p>
                  <div className="grid gap-4">
                    <div>
                      <Label htmlFor="dynamicProfile">Profile *</Label>
                      <Select
                        value={dynamicProfile}
                        onValueChange={(v: 'https-json-v1' | 'graphql-v1') => setDynamicProfile(v)}
                      >
                        <SelectTrigger id="dynamicProfile">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="https-json-v1">https-json-v1</SelectItem>
                          <SelectItem value="graphql-v1">graphql-v1</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="dynamicEndpoint">Endpoint URL *</Label>
                      <Input
                        id="dynamicEndpoint"
                        value={dynamicEndpoint}
                        onChange={(e) => setDynamicEndpoint(e.target.value)}
                        placeholder="https://api.example.com/query"
                      />
                    </div>
                    <div>
                      <Label htmlFor="dynamicMethod">HTTP Method</Label>
                      <Select
                        value={dynamicMethod}
                        onValueChange={(v: 'GET' | 'POST') => setDynamicMethod(v)}
                      >
                        <SelectTrigger id="dynamicMethod">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="GET">GET</SelectItem>
                          <SelectItem value="POST">POST</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="dynamicHeaders">Headers (JSON)</Label>
                      <Textarea
                        id="dynamicHeaders"
                        value={dynamicHeaders}
                        onChange={(e) => setDynamicHeaders(e.target.value)}
                        placeholder='{"Authorization": "Bearer token"}'
                        rows={3}
                        className="font-mono text-xs"
                      />
                    </div>
                    <div>
                      <Label htmlFor="dynamicQuery">Query Payload</Label>
                      <Textarea
                        id="dynamicQuery"
                        value={dynamicQuery}
                        onChange={(e) => setDynamicQuery(e.target.value)}
                        placeholder="GraphQL query or JSON body with {{template}} placeholders"
                        rows={4}
                        className="font-mono text-xs"
                      />
                    </div>
                    <div className="border-t border-border/30 pt-4">
                      <h4 className="mb-3 text-sm font-medium">Response Mapping</h4>
                      <div className="space-y-3">
                        <div>
                          <Label htmlFor="dynamicItemsPath">Items Path *</Label>
                          <Input
                            id="dynamicItemsPath"
                            value={dynamicItemsPath}
                            onChange={(e) => setDynamicItemsPath(e.target.value)}
                            placeholder="data.works (dot notation)"
                          />
                          <p className="mt-1 text-xs text-muted-foreground">
                            JSON path to the array of items
                          </p>
                        </div>
                        <div>
                          <Label htmlFor="dynamicItemSchema">Item Schema</Label>
                          <Input
                            id="dynamicItemSchema"
                            value={dynamicItemSchema}
                            onChange={(e) => setDynamicItemSchema(e.target.value)}
                            placeholder="dp1/1.1"
                          />
                          <p className="mt-1 text-xs text-muted-foreground">
                            DP-1 schema version (e.g., dp1/1.0, dp1/1.1)
                          </p>
                        </div>
                        <div>
                          <Label htmlFor="dynamicItemMap">Item Field Mapping (JSON)</Label>
                          <Textarea
                            id="dynamicItemMap"
                            value={dynamicItemMap}
                            onChange={(e) => setDynamicItemMap(e.target.value)}
                            placeholder='{"id": "artwork_id", "title": "name", "source": "media_url"}'
                            rows={3}
                            className="font-mono text-xs"
                          />
                          <p className="mt-1 text-xs text-muted-foreground">
                            Optional: Map response fields to DP-1 item schema
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            ) : null}

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
                onChange={(e) => handleJsonTextChange(e.target.value)}
                rows={20}
                className="font-mono text-[13px] leading-relaxed"
                placeholder="Edit playlist JSON…"
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
