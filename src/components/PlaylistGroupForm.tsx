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
import { useToast } from '@/hooks/use-toast'
import { generatePlaylistGroupSlug } from '@/lib/utils'
import { ethereumAddressToDIDPKH, signDocument, stripSignatureFields } from '@/lib/signing'
import { playlistGroupUnsignedPayloadForSigning } from '@/lib/playlistGroupSignPayload'
import { mergePlaylistGroupForPatch } from '@/lib/dp1Merge'
import { recordPublishedPlaylistGroup } from '@/lib/publishedStorage'
import {
  feedPlaylistGroupResourceUrl,
  getPlaylistGroup,
  patchPlaylistGroup,
  publishPlaylistGroup,
  validatePlaylistURI,
  checkPlaylistReachable,
  isDebugMode,
} from '@/lib/api'
import { FeedUrlToastDescription } from '@/components/FeedUrlToastDescription'
import type { PlaylistGroup } from '@/types/dp1'

interface PlaylistURIStatus {
  uri: string
  valid: boolean
  reachable?: boolean
  reason?: string
  checking: boolean
}

function parsePlaylistGroupJson(text: string): { group: PlaylistGroup } | { error: string } {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { error: 'Not valid JSON.' }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { error: 'Playlist group must be a JSON object.' }
  }
  const o = data as Record<string, unknown>
  const title = typeof o.title === 'string' ? o.title.trim() : ''
  if (!title || title.length > 200) {
    return { error: 'Title is required (max 200 characters).' }
  }
  if (!Array.isArray(o.playlists)) {
    return { error: 'Property "playlists" must be an array.' }
  }
  if (o.playlists.length === 0) {
    return { error: 'At least one playlist URI is required.' }
  }
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
  return { group: data as PlaylistGroup }
}

function parsePlaylistGroupJsonForFormSync(text: string): PlaylistGroup | null {
  const r = parsePlaylistGroupJson(text)
  return 'error' in r ? null : r.group
}

function groupFromJsonImport(raw: PlaylistGroup, fallbackId: string): PlaylistGroup {
  const { signatures: _s, signature: _legacy, ...rest } = raw as PlaylistGroup & {
    signature?: string
  }
  const created =
    typeof rest.created === 'string' && rest.created.trim() !== ''
      ? rest.created
      : new Date().toISOString()
  const lines = [...(rest.playlists ?? []).map((u) => (typeof u === 'string' ? u.trim() : String(u))).filter(Boolean)]
  return {
    ...rest,
    id: rest.id || fallbackId,
    created,
    playlists: lines,
  }
}

function validateGroupFields(
  group: Partial<PlaylistGroup>,
  options?: { expectedSignerKid?: string }
): string[] {
  const err: string[] = []
  if (!group.title?.trim()) err.push('Title is required')
  else if (group.title.length > 200) err.push('Title must be 200 characters or less')
  if (group.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(group.slug)) {
    err.push('Slug must be lowercase letters, numbers, and hyphens only')
  }
  if (!group.playlists || group.playlists.length === 0) {
    err.push('At least one playlist URI is required')
  }
  if (!group.curator?.trim()) {
    err.push('Curator DID is required for signature verification on the feed')
  } else if (!/^did:[a-z]+:.+$/.test(group.curator.trim())) {
    err.push('Curator must be a W3C DID (e.g. did:pkh:...)')
  } else if (
    options?.expectedSignerKid &&
    group.curator.trim() !== options.expectedSignerKid.trim()
  ) {
    err.push(
      `Curator DID must equal your signing key (${options.expectedSignerKid.slice(0, 24)}…)`
    )
  }
  if (group.summary && group.summary.length > 5000) {
    err.push('Summary is too long')
  }
  if (
    group.coverImage &&
    !/^(https?|ipfs|ar):\/\/.+/i.test(group.coverImage.trim())
  ) {
    err.push('Cover image must be a valid URI (https://, ipfs://, or ar://)')
  }
  return err
}

export default function PlaylistGroupForm({
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

  const loadedRef = useRef<PlaylistGroup | null>(null)
  const newGroupCreatedRef = useRef<string>(new Date().toISOString())

  const [id, setId] = useState(() => uuidv4())
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoadingDoc, setIsLoadingDoc] = useState(false)

  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [isAutoSlug, setIsAutoSlug] = useState(true)

  /** Curator signing key — must equal feed `kid` (verified server-side — see https://github.com/display-protocol/dp1-feed-v2). */
  const [curatorDid, setCuratorDid] = useState('')
  const [summary, setSummary] = useState('')
  const [coverImage, setCoverImage] = useState('')

  const [playlistsText, setPlaylistsText] = useState('')
  const [uriStatuses, setUriStatuses] = useState<PlaylistURIStatus[]>([])

  const [jsonMode, setJsonMode] = useState<'form' | 'json'>('form')
  const [jsonText, setJsonText] = useState('')
  const [isPublishing, setIsPublishing] = useState(false)

  const isEdit = Boolean(editId)

  useEffect(() => {
    if (address) {
      try {
        setCuratorDid((prev) =>
          prev.trim() ? prev : ethereumAddressToDIDPKH(getAddress(address))
        )
      } catch {
        /* ignore */
      }
    }
  }, [address])

  useEffect(() => {
    if (!editId || !address) {
      loadedRef.current = null
      return
    }
    let cancelled = false
    setLoadError(null)
    setIsLoadingDoc(true)
    getPlaylistGroup(editId)
      .then((g) => {
        if (cancelled) return
        loadedRef.current = g
        setId(g.id || uuidv4())
        setTitle(g.title)
        setIsAutoSlug(false)
        setSlug(g.slug || '')
        setCuratorDid(g.curator?.trim() || ethereumAddressToDIDPKH(getAddress(address)))
        setSummary(g.summary || '')
        setCoverImage(g.coverImage || '')
        const lines = (g.playlists ?? []).join('\n')
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
              checking: false,
              reachable: validation.valid ? true : undefined,
            }
          })
        )
        try {
          setJsonText(JSON.stringify(playlistGroupUnsignedPayloadForSigning(g), null, 2))
        } catch {
          setJsonText(JSON.stringify(stripSignatureFields(g as object), null, 2))
        }
        setJsonMode('form')
      })
      .catch((e) => {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : 'Failed to load playlist group')
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

  const autoSlug = generatePlaylistGroupSlug(title, id)
  const displaySlug = isAutoSlug ? autoSlug : slug

  const playlistsFromText = useCallback(() => {
    return playlistsText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
  }, [playlistsText])

  const buildGroup = useCallback((): PlaylistGroup => {
    const created = newGroupCreatedRef.current
    const kid = address ? ethereumAddressToDIDPKH(getAddress(address)) : ''
    const cur = curatorDid.trim() || kid

    return {
      id,
      slug: displaySlug,
      title: title.trim(),
      created,
      playlists: playlistsFromText(),
      curator: cur || undefined,
      summary: summary.trim() || undefined,
      coverImage: coverImage.trim() || undefined,
    }
  }, [
    id,
    displaySlug,
    title,
    curatorDid,
    summary,
    coverImage,
    playlistsFromText,
    address,
  ])

  const serializeJsonPreview = useCallback((): string => {
    if (isEdit && loadedRef.current) {
      const base = loadedRef.current
      const patchFields = {
        title: title.trim(),
        slug: displaySlug,
        playlists: playlistsFromText(),
        curator: curatorDid.trim(),
        summary: summary.trim() || undefined,
        coverImage: coverImage.trim() || undefined,
      }
      const merged = mergePlaylistGroupForPatch(base, patchFields)
      try {
        return JSON.stringify(playlistGroupUnsignedPayloadForSigning(merged), null, 2)
      } catch {
        return JSON.stringify(merged, null, 2)
      }
    }
    const g = buildGroup()
    try {
      return JSON.stringify(playlistGroupUnsignedPayloadForSigning(g), null, 2)
    } catch {
      return JSON.stringify(g, null, 2)
    }
  }, [
    isEdit,
    title,
    displaySlug,
    curatorDid,
    summary,
    coverImage,
    playlistsFromText,
    buildGroup,
  ])

  const applyParsedToForm = useCallback(
    (raw: PlaylistGroup) => {
      const g = groupFromJsonImport(raw, id)
      if (!isEdit && g.created?.trim()) {
        newGroupCreatedRef.current = g.created.trim()
      }
      const resolvedId = g.id || id
      setId(resolvedId)
      setTitle(g.title)
      const auto = generatePlaylistGroupSlug(g.title, resolvedId)
      if (!g.slug?.trim() || g.slug.trim() === auto) {
        setIsAutoSlug(true)
        setSlug('')
      } else {
        setIsAutoSlug(false)
        setSlug(g.slug.trim())
      }
      setCuratorDid(g.curator?.trim() || '')
      setSummary(g.summary || '')
      setCoverImage(g.coverImage || '')
      const lines = (g.playlists ?? []).join('\n')
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
            checking: false,
          }
        })
      )
    },
    [id, isEdit]
  )

  const handleJsonTextChange = (value: string) => {
    setJsonText(value)
    const trimmed = value.trim()
    if (!trimmed) return
    const g = parsePlaylistGroupJsonForFormSync(trimmed)
    if (!g) return
    applyParsedToForm(g)
  }

  useEffect(() => {
    if (jsonMode !== 'form' || isLoadingDoc) return
    if (isEdit && !loadedRef.current) return
    setJsonText(serializeJsonPreview())
  }, [jsonMode, isLoadingDoc, isEdit, serializeJsonPreview])

  const handleValidateURIs = async () => {
    const uris = playlistsFromText()
    if (uris.length === 0) {
      toast({
        title: 'Error',
        description: 'Enter at least one playlist URI.',
        variant: 'destructive',
      })
      return
    }

    const statuses: PlaylistURIStatus[] = uris.map((uri) => {
      const validation = validatePlaylistURI(uri)
      const skipReachability = validation.valid && isDebugMode()
      return {
        uri,
        valid: validation.valid,
        reason: validation.reason,
        checking: validation.valid && !skipReachability,
        reachable: skipReachability ? true : undefined,
      }
    })
    setUriStatuses(statuses)

    await Promise.all(
      statuses.map(async (status, index) => {
        if (!status.valid || isDebugMode()) return
        const reachable = await checkPlaylistReachable(status.uri)
        setUriStatuses((prev) => {
          const u = [...prev]
          if (u[index]) u[index] = { ...u[index], reachable, checking: false }
          return u
        })
      })
    )

    toast({ title: 'Validation complete', description: `Checked ${uris.length} URI(s)` })
  }

  const handlePublish = async () => {
    if (!walletClient || !address) {
      toast({ title: 'Error', description: 'Wallet not connected', variant: 'destructive' })
      return
    }

    const walletKid = ethereumAddressToDIDPKH(getAddress(address))

    if (isEdit) {
      if (!editId || !loadedRef.current) {
        toast({
          title: 'Error',
          description: loadError || 'Document not loaded yet.',
          variant: 'destructive',
        })
        return
      }

      let patchFields: Parameters<typeof mergePlaylistGroupForPatch>[1]

      if (jsonMode === 'json') {
        const trimmed = jsonText.trim()
        if (!trimmed) {
          toast({
            title: 'Error',
            description: 'Paste playlist group JSON or use the form.',
            variant: 'destructive',
          })
          return
        }
        const parsed = parsePlaylistGroupJson(trimmed)
        if ('error' in parsed) {
          toast({ title: 'Invalid JSON', description: parsed.error, variant: 'destructive' })
          return
        }
        const p = groupFromJsonImport(parsed.group, id)
        patchFields = {
          title: p.title.trim(),
          slug: p.slug ?? loadedRef.current.slug ?? '',
          playlists: p.playlists,
          curator: p.curator?.trim() ?? walletKid,
          summary: p.summary,
          coverImage: p.coverImage,
        }
      } else {
        if (!title.trim()) {
          toast({ title: 'Error', description: 'Title is required', variant: 'destructive' })
          return
        }
        const pls = playlistsFromText()
        if (pls.length === 0) {
          toast({
            title: 'Error',
            description: 'At least one playlist URI is required.',
            variant: 'destructive',
          })
          return
        }
        const cur = curatorDid.trim()
        if (!cur) {
          toast({ title: 'Error', description: 'Curator DID is required', variant: 'destructive' })
          return
        }
        patchFields = {
          title: title.trim(),
          slug: displaySlug,
          playlists: pls,
          curator: cur,
          summary: summary.trim() || undefined,
          coverImage: coverImage.trim() || undefined,
        }
      }

      const merged = mergePlaylistGroupForPatch(loadedRef.current, patchFields)
      const v = validateGroupFields(merged, { expectedSignerKid: walletKid })
      if (v.length) {
        toast({ title: 'Validation failed', description: v[0], variant: 'destructive' })
        return
      }

      if (!merged.id?.trim() || !merged.created?.trim()) {
        toast({ title: 'Error', description: 'Document is missing id or created', variant: 'destructive' })
        return
      }

      const unsigned: PlaylistGroup = merged

      let wire: Record<string, unknown>
      try {
        wire = playlistGroupUnsignedPayloadForSigning(unsigned)
      } catch (e) {
        toast({
          title: 'Error',
          description: e instanceof Error ? e.message : 'Cannot build sign payload',
          variant: 'destructive',
        })
        return
      }

      setIsPublishing(true)
      try {
        const signature = await signDocument(wire, walletClient, 'curator')
        const body: Record<string, unknown> = {
          title: merged.title,
          slug: merged.slug,
          playlists: merged.playlists,
          signatures: [signature],
        }
        if (merged.curator) body.curator = merged.curator
        if (merged.summary !== undefined) body.summary = merged.summary
        if (merged.coverImage !== undefined) body.coverImage = merged.coverImage

        const updated = await patchPlaylistGroup(editId, body)
        recordPublishedPlaylistGroup(address, updated)
        onPublished?.()
        loadedRef.current = updated
        toast({
          title: 'Updated',
          description: (
            <FeedUrlToastDescription
              url={feedPlaylistGroupResourceUrl(updated.slug?.trim() || updated.id || '')}
            />
          ),
        })
      } catch (error) {
        console.error(error)
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

    let unsignedGroup: PlaylistGroup

    if (jsonMode === 'json') {
      const trimmed = jsonText.trim()
      if (!trimmed) {
        toast({
          title: 'Error',
          description: 'Paste playlist group JSON or use the form.',
          variant: 'destructive',
        })
        return
      }
      const parsed = parsePlaylistGroupJson(trimmed)
      if ('error' in parsed) {
        toast({ title: 'Invalid JSON', description: parsed.error, variant: 'destructive' })
        return
      }
      unsignedGroup = groupFromJsonImport(parsed.group, id)
      if (!unsignedGroup.curator?.trim()) {
        unsignedGroup.curator = walletKid
      }
    } else {
      if (!title.trim()) {
        toast({ title: 'Error', description: 'Title is required', variant: 'destructive' })
        return
      }
      const pls = playlistsFromText()
      if (pls.length === 0) {
        toast({
          title: 'Error',
          description: 'At least one playlist URI is required.',
          variant: 'destructive',
        })
        return
      }
      const cur = curatorDid.trim() || walletKid
      unsignedGroup = {
        id,
        slug: displaySlug,
        title: title.trim(),
        created: newGroupCreatedRef.current,
        playlists: pls,
        curator: cur,
        summary: summary.trim() || undefined,
        coverImage: coverImage.trim() || undefined,
      }
    }

    const vErr = validateGroupFields(unsignedGroup, { expectedSignerKid: walletKid })
    if (vErr.length) {
      toast({ title: 'Validation failed', description: vErr[0], variant: 'destructive' })
      return
    }

    let wire: Record<string, unknown>
    try {
      wire = playlistGroupUnsignedPayloadForSigning(unsignedGroup)
    } catch (e) {
      toast({
        title: 'Error',
        description: e instanceof Error ? e.message : 'Cannot build sign payload',
        variant: 'destructive',
      })
      return
    }

    setIsPublishing(true)
    try {
      const signature = await signDocument(wire, walletClient, 'curator')
      const payload = {
        ...wire,
        signatures: [signature],
      }

      const published = await publishPlaylistGroup(payload)
      recordPublishedPlaylistGroup(address, published)
      onPublished?.()

      toast({
        title: 'Published',
        description: (
          <FeedUrlToastDescription
            url={feedPlaylistGroupResourceUrl(published.slug?.trim() || published.id || '')}
          />
        ),
      })

      setTitle('')
      setSummary('')
      setCoverImage('')
      setPlaylistsText('')
      setSlug('')
      setIsAutoSlug(true)
      setJsonText('')
      newGroupCreatedRef.current = new Date().toISOString()
      setUriStatuses([])
      setCuratorDid(walletKid)
      setId(uuidv4())
    } catch (error) {
      console.error(error)
      toast({
        title: 'Publish failed',
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
        <p className="section-label">Playlist group</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="font-display text-2xl font-normal sm:text-[1.75rem]">
              {isEdit ? 'Edit playlist group' : 'New playlist group'}
            </CardTitle>
            <CardDescription className="text-[15px]">
              Core DP-1 exhibition: ordered playlist URIs. The feed resolves each URI to a stored playlist
              (same rules as channels). Curator DID must match your signing key (
              <code className="text-xs">kid</code>).
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
            <span>Loading playlist group…</span>
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

            <TabsContent value="form" className="mt-8 space-y-8">
              <div className="space-y-4">
                <h3 className="section-label">Details</h3>
                <div>
                  <Label htmlFor="pg-title">Title *</Label>
                  <Input
                    id="pg-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Exhibition title"
                  />
                </div>
                <div>
                  <Label htmlFor="pg-slug">Slug</Label>
                  <div className="flex gap-2">
                    <Input
                      id="pg-slug"
                      value={displaySlug}
                      onChange={(e) => {
                        setSlug(e.target.value)
                        setIsAutoSlug(false)
                      }}
                      placeholder="Auto from title"
                    />
                    {!isAutoSlug ? (
                      <Button type="button" variant="outline" onClick={() => setIsAutoSlug(true)}>
                        Reset
                      </Button>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Suggested: {autoSlug}</p>
                </div>
                <div>
                  <Label htmlFor="pg-curator">Curator DID *</Label>
                  <Input
                    id="pg-curator"
                    value={curatorDid}
                    onChange={(e) => setCuratorDid(e.target.value)}
                    placeholder={address ? ethereumAddressToDIDPKH(getAddress(address)) : 'did:pkh:…'}
                    className="font-mono text-xs"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Must match the signature key (<code>kid</code>). Defaults to your connected wallet DID.
                  </p>
                </div>
                <div>
                  <Label htmlFor="pg-summary">Summary</Label>
                  <Textarea
                    id="pg-summary"
                    rows={3}
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                    placeholder="Optional curatorial statement"
                  />
                </div>
                <div>
                  <Label htmlFor="pg-cover">Cover image URI</Label>
                  <Input
                    id="pg-cover"
                    value={coverImage}
                    onChange={(e) => setCoverImage(e.target.value)}
                    placeholder="https://… or ipfs://…"
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="section-label">Playlist URIs *</h3>
                  <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={handleValidateURIs}>
                    Validate URIs
                  </Button>
                </div>
                <Textarea
                  rows={8}
                  value={playlistsText}
                  onChange={(e) => {
                    const v = e.target.value
                    setPlaylistsText(v)
                    const uris = v
                      .split('\n')
                      .map((l) => l.trim())
                      .filter((l) => l.length > 0)
                    setUriStatuses(
                      uris.map((uri) => {
                        const validation = validatePlaylistURI(uri)
                        return { uri, valid: validation.valid, reason: validation.reason, checking: false }
                      })
                    )
                  }}
                  placeholder="One playlist URL per line (https:// feed URLs or ipfs:// …)"
                  className="font-mono text-[13px]"
                />
                {uriStatuses.length > 0 ? (
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {uriStatuses.map((s, i) => (
                      <li key={`${s.uri}-${i}`}>
                        <span className={s.valid ? 'text-foreground' : 'text-destructive'}>{s.uri}</span>
                        {!s.valid && s.reason ? (
                          <span className="ml-2 text-destructive">— {s.reason}</span>
                        ) : null}
                        {s.valid && s.checking ? (
                          <span className="ml-2">Checking…</span>
                        ) : null}
                        {s.valid && s.reachable === false ? (
                          <span className="ml-2 text-amber-600">HEAD not OK</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <div className="flex flex-col-reverse gap-3 border-t border-border/50 pt-8 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => {
                    setJsonText(serializeJsonPreview())
                    setJsonMode('json')
                  }}
                >
                  Preview JSON
                </Button>
                <Button
                  type="button"
                  className="rounded-full px-8"
                  onClick={() => void handlePublish()}
                  disabled={isPublishing}
                >
                  {isPublishing ? (isEdit ? 'Saving…' : 'Publishing…') : isEdit ? 'Sign & update' : 'Sign & publish'}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="json" className="mt-8">
              <div className="space-y-6">
                <Textarea
                  value={jsonText}
                  onChange={(e) => handleJsonTextChange(e.target.value)}
                  rows={22}
                  className="font-mono text-[13px] leading-relaxed"
                  placeholder="Playlist group JSON (unsigned, no signatures)…"
                />
                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <Button type="button" variant="outline" className="rounded-full" onClick={() => setJsonMode('form')}>
                    Back to form
                  </Button>
                  <Button
                    type="button"
                    className="rounded-full px-8"
                    onClick={() => void handlePublish()}
                    disabled={isPublishing}
                  >
                    {isPublishing ? (isEdit ? 'Saving…' : 'Publishing…') : isEdit ? 'Sign & update' : 'Sign & publish'}
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
