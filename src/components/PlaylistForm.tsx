import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useAccount, useWalletClient } from 'wagmi'
import { v4 as uuidv4 } from 'uuid'
import { getAddress } from 'viem'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  playlistFormCreateDescription,
  playlistFormCreateDescriptionCoreOnly,
  publishFormEditDescription,
} from '@/lib/publishFormDescriptions'
import { Tabs, TabsContent, TabsList, TabsTrigger, editorModeListClass, editorModeTriggerClass } from '@/components/ui/tabs'
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
import {
  FeedAPIError,
  feedPlaylistResourceUrl,
  friendlyPublishError,
  getPlaylist,
  patchPlaylist,
  publishPlaylist,
  validatePlaylistURI,
} from '@/lib/api'
import { FeedUrlToastDescription } from '@/components/FeedUrlToastDescription'
import {
  isWalletAuthorizedToOverwrite,
  wrongWalletForOverwriteMessage,
} from '@/lib/overwriteAuth'
import { mergePlaylistForPatch } from '@/lib/dp1Merge'
import { stripPlaylistExtensionFields, stripItemExtensionFields } from '@/lib/dp1ExtensionPolicy'
import { recordPublishedPlaylist } from '@/lib/publishedStorage'
import type { DynamicQuery, Entity, Playlist, PlaylistItem } from '@/types/dp1'
import SeriesExpander from './SeriesExpander'
import ManualItemsSection from './ManualItemsSection'
import CuratorList from './CuratorList'
import JsonFileDropZone from './JsonFileDropZone'
import { preparePlaylistForPublish } from '@/lib/preparePublish'
import { itemsForPlaylistExport, playlistItemExportCount } from '@/lib/playlistItems'
import PostPublishPanel from './PostPublishPanel'

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
      // Validate URI format and security
      const validation = validatePlaylistURI(src)
      if (!validation.valid) {
        return { error: `items[${i}].source: ${validation.reason || 'Invalid URI'}` }
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
  onUseInNewChannel,
  existingChannels,
  onAddToExistingChannel,
  onViewPublished,
  extensionsEnabled,
}: {
  editId?: string
  onCancelEdit?: () => void
  onPublished?: () => void
  /** Fires when the user clicks "Start a new channel" on the post-publish panel. */
  onUseInNewChannel?: (feedUrl: string) => void
  /** User's existing channels (read from localStorage); each renders as an
   * "Add to: <title>" CTA on the post-publish panel. */
  existingChannels?: { id: string; title: string }[]
  /** Fires when the user picks an existing channel to add this playlist to. */
  onAddToExistingChannel?: (channelId: string, feedUrl: string) => void
  /** Called when the user clicks "View all published" after a create publish. */
  onViewPublished?: () => void
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
  /** After a successful create publish, hold the feed URL + title so the
   * post-publish panel can replace the form until the user picks a next step.
   * `mode='update'` means the publish detected an existing playlist with the
   * same id and replaced it via PATCH; `mode='create'` is a fresh POST.
   * `receipts` captures the prepare-pipeline notes (wallet identity replacement,
   * curator injection, etc.) so the user has a permanent record. */
  const [publishedDoc, setPublishedDoc] = useState<{
    feedUrl: string
    title: string
    mode: 'create' | 'update'
    receipts: { title: string; description: string }[]
  } | null>(null)

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

  const handleSeriesAdd = useCallback(
    (newItems: PlaylistItem[], releaseName: string | null) => {
      // Each series add replaces the whole items list — manual rows from prior edits are cleared.
      setItems(newItems)
      if (!title.trim() && releaseName?.trim()) {
        setTitle(releaseName.trim())
      }
    },
    [title]
  )

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

    const mappedItems = itemsForPlaylistExport(items).map((item) => {
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

      const mappedItems = itemsForPlaylistExport(items).map((item) => {
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

  /**
   * Form-tab specific pre-publish validation (immediate UX feedback for
   * fields the user is editing right now). Returns null when OK, or an error
   * description string to surface in a destructive toast. JSON-tab mode does
   * not run this — `parsePlaylistJson` covers the schema checks there.
   */
  const validateFormTab = (): string | null => {
    if (!title.trim()) return 'Title is required'
    const allowEmptyViaDynamic = extensionsEnabled && enableDynamicQuery
    const exportItems = itemsForPlaylistExport(items)
    if (!allowEmptyViaDynamic && (exportItems.length === 0 || exportItems.some((item) => !item.source))) {
      return extensionsEnabled
        ? 'At least one item with source URI is required, or enable Dynamic Query'
        : 'At least one item with source URI is required'
    }
    if (extensionsEnabled && enableDynamicQuery) {
      if (!dynamicEndpoint.trim()) return 'Dynamic Query: Endpoint is required'
      if (!dynamicItemsPath.trim()) return 'Dynamic Query: Items Path is required'
      if (dynamicHeaders.trim()) {
        try {
          JSON.parse(dynamicHeaders)
        } catch {
          return 'Dynamic Query: Headers must be valid JSON'
        }
      }
      if (dynamicItemMap.trim()) {
        try {
          JSON.parse(dynamicItemMap)
        } catch {
          return 'Dynamic Query: Item Map must be valid JSON'
        }
      }
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
        description: loadError || 'Playlist not loaded yet.',
        variant: 'destructive',
      })
      return
    }

    // Step 1: resolve raw document — from form state or from imported JSON.
    let rawDocument: Playlist
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
      rawDocument = playlistFromJsonImport(parsed.playlist, id)
    } else {
      const formError = validateFormTab()
      if (formError) {
        toast({ title: 'Error', description: formError, variant: 'destructive' })
        return
      }
      rawDocument = buildPlaylist()
    }

    setIsPublishing(true)
    // Tracks whether the operation we ultimately attempt is an update (PATCH).
    // Both explicit edit-mode and auto-overwrite count; used so the catch
    // surfaces the "different wallet" message instead of the create variant.
    let attemptedUpdate = isEdit
    try {
      // Step 2: pre-flight overwrite detection. On create publishes, look up
      // the document's id on the feed; if it already exists, switch to PATCH
      // so the user transparently overwrites their own prior publish (same
      // wallet → feed accepts). A different wallet's signature will fail at
      // PATCH and surface a friendly "wrong wallet" error.
      const targetId = rawDocument.id
      let overwriteBase: Playlist | undefined
      if (!isEdit && targetId) {
        try {
          overwriteBase = await getPlaylist(targetId)
        } catch (e) {
          // 404 is the happy path — proceed with POST. Other errors:
          // ignore the pre-flight signal and let the POST surface whatever
          // happens next, so we don't false-fail on a transient feed blip.
          if (!(e instanceof FeedAPIError) || e.status !== 404) {
            // swallowed by design
          }
        }
      }
      const walletDID = ethereumAddressToDIDPKH(getAddress(address))

      // Step 2b: pre-sign ownership gate. If preflight found an existing doc
      // but the connected wallet did not sign it as curator, refuse to sign a
      // wallet-rewritten payload — abort with the friendly wrong-wallet error
      // before any identity mutation runs in preparePublish.
      if (overwriteBase && targetId) {
        if (!isWalletAuthorizedToOverwrite(overwriteBase, 'curator', walletDID)) {
          toast({
            title: 'Update failed',
            description: wrongWalletForOverwriteMessage('playlist'),
            variant: 'destructive',
          })
          return
        }
        attemptedUpdate = true
      }

      // Step 3: route through the single publish pipeline. signedPayload and
      // wireBody come out together so they can't drift.
      const prepared = preparePlaylistForPublish({
        rawDocument,
        walletDID,
        base: isEdit ? loadedRef.current ?? undefined : overwriteBase,
        extensionsEnabled,
      })
      if ('validationErrors' in prepared) {
        toast({
          title: 'Validation error',
          description: prepared.validationErrors[0],
          variant: 'destructive',
        })
        return
      }
      prepared.toasts.forEach((t) => toast(t))

      // Step 4: sign and POST/PATCH.
      const signature = await signDocument(prepared.signedBytes, walletClient, 'curator')
      const body = { ...prepared.wireBody, signatures: [signature] }

      if (isEdit && editId) {
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
      } else if (overwriteBase && targetId) {
        // Overwrite-on-create: feed already has this id, PATCH instead.
        const updated = await patchPlaylist(targetId, body)
        recordPublishedPlaylist(address, updated)
        onPublished?.()
        const feedUrl = feedPlaylistResourceUrl(
          updated.slug?.trim() || updated.id || ''
        )
        setPublishedDoc({
          feedUrl,
          title: updated.title?.trim() || 'Untitled playlist',
          mode: 'update',
          receipts: prepared.toasts.map((t) => ({
            title: t.title,
            description: t.description,
          })),
        })
        // Reset form so "Publish another" returns to a clean state.
        setTitle('')
        setSlug('')
        setIsAutoSlug(true)
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
        setId(uuidv4())
      } else {
        const published = await publishPlaylist(body as Playlist)
        recordPublishedPlaylist(address, published)
        onPublished?.()
        const feedUrl = feedPlaylistResourceUrl(
          published.slug?.trim() || published.id || ''
        )
        setPublishedDoc({
          feedUrl,
          title: published.title?.trim() || 'Untitled playlist',
          mode: 'create',
          receipts: prepared.toasts.map((t) => ({
            title: t.title,
            description: t.description,
          })),
        })
        // Reset form (create only — edit leaves the form populated)
        setTitle('')
        setSlug('')
        setIsAutoSlug(true)
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
        setId(uuidv4())
      }
    } catch (error) {
      console.error(attemptedUpdate ? 'Update failed:' : 'Publish failed:', error)
      toast({
        title: attemptedUpdate ? 'Update failed' : 'Publish failed',
        description: friendlyPublishError(
          error,
          'playlist',
          attemptedUpdate ? 'update' : 'create'
        ),
        variant: 'destructive',
      })
    } finally {
      setIsPublishing(false)
    }
  }

  if (publishedDoc) {
    return (
      <PostPublishPanel
        kind="playlist"
        mode={publishedDoc.mode}
        feedUrl={publishedDoc.feedUrl}
        title={publishedDoc.title}
        receipts={publishedDoc.receipts}
        onUseInNewChannel={
          extensionsEnabled && onUseInNewChannel
            ? () => onUseInNewChannel(publishedDoc.feedUrl)
            : undefined
        }
        existingChannels={extensionsEnabled ? existingChannels : []}
        onAddToExistingChannel={
          extensionsEnabled && onAddToExistingChannel
            ? (channelId) =>
                onAddToExistingChannel(channelId, publishedDoc.feedUrl)
            : undefined
        }
        onPublishAnother={() => setPublishedDoc(null)}
        onViewPublished={() => {
          if (onViewPublished) {
            onViewPublished()
          } else {
            setPublishedDoc(null)
          }
        }}
      />
    )
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
                ? publishFormEditDescription
                : extensionsEnabled
                  ? playlistFormCreateDescription
                  : playlistFormCreateDescriptionCoreOnly}
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
          <TabsList className={editorModeListClass}>
            <TabsTrigger value="form" className={editorModeTriggerClass}>
              Form
            </TabsTrigger>
            <TabsTrigger value="json" className={editorModeTriggerClass}>
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

            {/* Playlist items — series load first, then manual entry */}
            <div className="space-y-5">
              <span className="section-label">Playlist items · {playlistItemExportCount(items)}</span>
              <SeriesExpander onAdd={handleSeriesAdd} />
              <ManualItemsSection
                items={items}
                showIntermissionNote={extensionsEnabled}
                onAddItem={handleAddItem}
                onUpdateItem={handleUpdateItem}
                onRemoveItem={handleRemoveItem}
              />
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
