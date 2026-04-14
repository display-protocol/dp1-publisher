import { useState } from 'react'
import { Check, Loader2, MinusCircle, AlertCircle } from 'lucide-react'
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
import { signDocument } from '@/lib/signing'
import { publishChannel, validatePlaylistURI, checkPlaylistReachable } from '@/lib/api'
import type { Channel, Entity } from '@/types/dp1'
import CuratorList from './CuratorList'

interface PlaylistURIStatus {
  uri: string
  valid: boolean
  reachable?: boolean
  reason?: string
  checking: boolean
}

interface ValidationError {
  field: string
  message: string
}

function validateChannelFields(channel: Partial<Channel>): ValidationError[] {
  const errors: ValidationError[] = []
  
  // Title validation
  if (!channel.title || channel.title.trim().length === 0) {
    errors.push({ field: 'title', message: 'Title is required' })
  } else if (channel.title.length > 200) {
    errors.push({ field: 'title', message: 'Title must be 200 characters or less' })
  }
  
  // Slug validation (lowercase, hyphens only)
  if (channel.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(channel.slug)) {
    errors.push({ field: 'slug', message: 'Slug must contain only lowercase letters, numbers, and hyphens' })
  }
  
  // Summary validation
  if (channel.summary && channel.summary.length > 2000) {
    errors.push({ field: 'summary', message: 'Summary must be 2000 characters or less' })
  }
  
  // Cover image validation (basic URI format)
  if (channel.coverImage && !/^(https?|ipfs|ar):\/\/.+/.test(channel.coverImage)) {
    errors.push({ field: 'coverImage', message: 'Cover image must be a valid URI (https://, ipfs://, or ar://)' })
  }
  
  // Playlists validation
  if (!channel.playlists || channel.playlists.length === 0) {
    errors.push({ field: 'playlists', message: 'At least one playlist URI is required' })
  }
  
  // Publisher validation
  if (channel.publisher) {
    if (!channel.publisher.name || channel.publisher.name.trim().length === 0) {
      errors.push({ field: 'publisher.name', message: 'Publisher name is required' })
    }
    if (!channel.publisher.key || !/^did:[a-z]+:.+$/.test(channel.publisher.key)) {
      errors.push({ field: 'publisher.key', message: 'Publisher key must be in DID format' })
    }
    if (channel.publisher.url && !/^https?:\/\/.+/.test(channel.publisher.url)) {
      errors.push({ field: 'publisher.url', message: 'Publisher URL must be a valid HTTP(S) URL' })
    }
  }
  
  // Curators validation
  if (channel.curators) {
    channel.curators.forEach((curator, index) => {
      if (!curator.name || curator.name.trim().length === 0) {
        errors.push({ field: `curators[${index}].name`, message: `Curator ${index + 1} name is required` })
      }
      if (!curator.key || !/^did:[a-z]+:.+$/.test(curator.key)) {
        errors.push({ field: `curators[${index}].key`, message: `Curator ${index + 1} key must be in DID format` })
      }
      if (curator.url && !/^https?:\/\/.+/.test(curator.url)) {
        errors.push({ field: `curators[${index}].url`, message: `Curator ${index + 1} URL must be a valid HTTP(S) URL` })
      }
    })
  }
  
  return errors
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
  return { channel: data as Channel }
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

export default function ChannelForm() {
  const { address } = useAccount()
  const { data: walletClient } = useWalletClient()
  const { toast } = useToast()

  const [id] = useState(uuidv4())
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [isAutoSlug, setIsAutoSlug] = useState(true)
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

  // Auto-generate slug
  const autoSlug = generateChannelSlug(title, id)
  const displaySlug = isAutoSlug ? autoSlug : slug

  const handleValidateURIs = async () => {
    const uris = playlistsText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)

    if (uris.length === 0) {
      toast({ title: 'Error', description: 'Please enter at least one playlist URI', variant: 'destructive' })
      return
    }

    // Validate format first
    const statuses: PlaylistURIStatus[] = uris.map(uri => {
      const validation = validatePlaylistURI(uri)
      return {
        uri,
        valid: validation.valid,
        reason: validation.reason,
        checking: validation.valid, // Only check reachability if valid format
      }
    })

    setUriStatuses(statuses)

    // Check reachability for valid URIs
    const reachabilityPromises = statuses.map(async (status, index) => {
      if (status.valid) {
        const reachable = await checkPlaylistReachable(status.uri)
        setUriStatuses(prev => {
          const updated = [...prev]
          updated[index] = { ...updated[index], reachable, checking: false }
          return updated
        })
      }
    })

    await Promise.all(reachabilityPromises)

    toast({ title: 'Validation Complete', description: `Checked ${uris.length} URIs` })
  }

  const buildChannel = (): Channel => {
    const created = new Date().toISOString()
    
    const playlists = playlistsText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)

    const publisher: Entity = {
      name: publisherName || '',
      key: ethereumAddressToDIDPKH(getAddress(address!)),
      url: publisherUrl || undefined,
    }
    
    return {
      id,
      slug: displaySlug,
      title,
      version: '1.0.0',
      created,
      playlists,
      publisher,
      curators: curators.length > 0 ? curators : undefined,
      summary: summary || undefined,
      coverImage: coverImage || undefined,
    }
  }

  const handleGenerateJSON = () => {
    const channel = buildChannel()
    setJsonText(JSON.stringify(channel, null, 2))
    setJsonMode('json')
  }

  const handlePublish = async () => {
    if (!walletClient || !address) {
      toast({ title: 'Error', description: 'Wallet not connected', variant: 'destructive' })
      return
    }

    let unsignedChannel: Channel

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
      unsignedChannel = channelFromJsonImport(parsed.channel, id)
    } else {
      // Build channel from form
      const channel = buildChannel()

      // Validate the channel
      const validationErrors = validateChannelFields(channel)
      if (validationErrors.length > 0) {
        toast({ 
          title: 'Validation Error', 
          description: validationErrors[0].message,
          variant: 'destructive' 
        })
        return
      }

      // Check if all URIs are validated
      const playlists = playlistsText
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)

      const allValidated = uriStatuses.length === playlists.length
      if (!allValidated) {
        toast({ 
          title: 'Validation Required', 
          description: 'Please validate URIs before publishing', 
          variant: 'destructive' 
        })
        return
      }

      const hasInvalidURIs = uriStatuses.some(status => !status.valid)
      if (hasInvalidURIs) {
        toast({ 
          title: 'Invalid URIs', 
          description: 'Please fix invalid URIs before publishing', 
          variant: 'destructive' 
        })
        return
      }

      unsignedChannel = channel
    }

    setIsPublishing(true)

    try {
      // Sign the channel
      const signature = await signDocument(unsignedChannel, walletClient, 'publisher')

      // Add signature
      const signedChannel: Channel = {
        ...unsignedChannel,
        signatures: [signature]
      }

      // Publish to feed server
      const published = await publishChannel(signedChannel)

      toast({
        title: 'Success!',
        description: `Channel published: ${published.slug}`,
      })

      // Reset form
      setTitle('')
      setSummary('')
      setCoverImage('')
      setPlaylistsText('')
      setUriStatuses([])
      setPublisherName('')
      setPublisherUrl('')
      setCurators([])
      setJsonText('')
      
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
        <p className="section-label">Channel</p>
        <CardTitle className="font-display text-2xl font-normal sm:text-[1.75rem]">
          New channel
        </CardTitle>
        <CardDescription className="text-[15px]">
          Point to playlists that already exist on the feed, then sign as publisher.
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-8">
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
                        ) : status.checking ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden />
                        ) : status.reachable ? (
                          <Check className="size-4 text-foreground/70" aria-hidden />
                        ) : (
                          <AlertCircle className="size-4 text-amber-600" aria-hidden />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-[13px] text-foreground">{status.uri}</p>
                        {!status.valid && status.reason && (
                          <p className="mt-1 text-xs text-destructive">{status.reason}</p>
                        )}
                        {status.valid && !status.checking && status.reachable === false && (
                          <p className="mt-1 text-xs text-amber-700">Unreachable (may still work)</p>
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
                {isPublishing ? 'Publishing…' : 'Sign & publish'}
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
                placeholder="Paste channel JSON…"
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
                  {isPublishing ? 'Publishing…' : 'Sign & publish'}
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
