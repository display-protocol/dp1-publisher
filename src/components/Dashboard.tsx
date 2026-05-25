import { useEffect, useMemo, useState } from 'react'
import { useAccount } from 'wagmi'
import { History, Layers, ListMusic, Radio, Upload } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Toaster } from '@/components/ui/toaster'
import { cn } from '@/lib/utils'
import { useDp1Extensions } from '@/context/Dp1ExtensionsContext'
import { loadPublished, sortByCreatedDesc } from '@/lib/publishedStorage'
import WalletConnect from './WalletConnect'
import PlaylistForm from './PlaylistForm'
import PlaylistGroupForm from './PlaylistGroupForm'
import ChannelForm from './ChannelForm'
import PublishedView from './PublishedView'

type PublishTab = 'playlist' | 'group' | 'channel'

export default function Dashboard() {
  const { isConnected, address } = useAccount()
  const { extensionsEnabled, extensionsLoading } = useDp1Extensions()
  const [view, setView] = useState<'publish' | 'published'>('publish')
  const [publishTab, setPublishTab] = useState<PublishTab>('playlist')
  /** When set, the channel form is rendered with this URL pre-filled into `playlists[]`.
   * Bumped via the "Start a new channel" CTA after publishing a playlist. */
  const [pendingChannelPlaylistsText, setPendingChannelPlaylistsText] =
    useState<string | undefined>(undefined)
  /** When set, a channel edit appends this URL to the loaded channel's playlists[].
   * Bumped via "Add to: <channel>" CTA on the post-publish panel. */
  const [pendingAppendPlaylistUrl, setPendingAppendPlaylistUrl] =
    useState<string | undefined>(undefined)
  const [publishedTick, setPublishedTick] = useState(0)
  const [editPlaylistId, setEditPlaylistId] = useState<string | null>(null)
  const [editPlaylistGroupId, setEditPlaylistGroupId] = useState<string | null>(null)
  const [editChannelId, setEditChannelId] = useState<string | null>(null)

  const bumpPublished = () => setPublishedTick((n) => n + 1)

  /** Existing channels the user has published from this browser. Rebuilt
   * whenever a new publish happens (publishedTick). Powers the "Add to: <channel>"
   * CTAs on the playlist post-publish panel. */
  const existingChannels = useMemo(() => {
    if (!address || !extensionsEnabled) return []
    const bucket = loadPublished(address)
    return sortByCreatedDesc(bucket.channels).map((c) => ({
      id: c.id,
      title: c.title || 'Untitled channel',
    }))
    // publishedTick is intentionally part of the dep set so a fresh channel
    // publish refreshes this list without a full reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, extensionsEnabled, publishedTick])

  useEffect(() => {
    if (!extensionsEnabled) {
      setEditChannelId(null)
      if (publishTab === 'channel') {
        setPublishTab('playlist')
      }
      setPendingChannelPlaylistsText(undefined)
      setPendingAppendPlaylistUrl(undefined)
    }
  }, [extensionsEnabled, publishTab])

  const clearEditState = () => {
    setEditPlaylistId(null)
    setEditPlaylistGroupId(null)
    setEditChannelId(null)
    setPendingAppendPlaylistUrl(undefined)
  }

  const handleUseInNewChannel = (feedUrl: string) => {
    setPendingChannelPlaylistsText(feedUrl)
    setPendingAppendPlaylistUrl(undefined)
    setPublishTab('channel')
    setView('publish')
    setEditPlaylistId(null)
    setEditPlaylistGroupId(null)
    setEditChannelId(null)
  }

  const handleAddToExistingChannel = (channelId: string, feedUrl: string) => {
    // Edit mode for a channel lives under the `published` view (the same path
    // a user takes from the Published list → click a channel → edit). Setting
    // editChannelId + view='published' renders the ChannelForm in edit mode;
    // the appendPlaylistUrl prop then appends the new URL after the load completes.
    setPendingChannelPlaylistsText(undefined)
    setPendingAppendPlaylistUrl(feedUrl)
    setEditPlaylistId(null)
    setEditPlaylistGroupId(null)
    setEditChannelId(channelId)
    setView('published')
  }

  const handleViewPublished = () => {
    clearEditState()
    setView('published')
  }

  return (
    <>
      <div className="relative mx-auto max-w-3xl px-5 py-14 sm:px-8 sm:py-20">
        <header className="mb-10 flex flex-col gap-8 sm:mb-12 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-4">
            <p className="section-label">Display Protocol</p>
            <div className="space-y-3">
              <h1 className="font-display text-[2rem] font-normal leading-[1.15] tracking-tight text-foreground sm:text-4xl">
                Publisher
              </h1>
              <p className="max-w-sm text-[15px] leading-relaxed text-muted-foreground">
                {extensionsEnabled
                  ? 'Publish core playlists and playlist groups, and channel documents when extensions are on.'
                  : 'Publish core DP-1 playlists and playlist groups. Channel UI is hidden when extensions are off for this deployment.'}
              </p>
              {extensionsLoading ? (
                <p className="text-xs text-muted-foreground">Checking feed extension settings…</p>
              ) : null}
            </div>
          </div>
          {isConnected ? (
            <div className="shrink-0 sm:pt-1">
              <WalletConnect />
            </div>
          ) : null}
        </header>

        {isConnected ? (
          <div className="mb-10 flex justify-center sm:mb-12">
            <div
              role="tablist"
              aria-label="Publisher section"
              className="inline-flex h-11 items-center gap-1 rounded-full border border-border/60 bg-card/90 p-1.5 shadow-sm backdrop-blur-sm"
            >
              <button
                type="button"
                role="tab"
                aria-selected={view === 'publish'}
                onClick={() => {
                  clearEditState()
                  setView('publish')
                }}
                className={cn(
                  'flex items-center gap-2 rounded-full px-4 text-[13px] font-medium transition-colors',
                  view === 'publish'
                    ? 'bg-foreground text-background shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Upload className="size-3.5" aria-hidden />
                Publish
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'published'}
                onClick={handleViewPublished}
                className={cn(
                  'flex items-center gap-2 rounded-full px-4 text-[13px] font-medium transition-colors',
                  view === 'published'
                    ? 'bg-foreground text-background shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <History className="size-3.5" aria-hidden />
                Published
              </button>
            </div>
          </div>
        ) : null}

        {!isConnected ? (
          <Card className="border-border/50 shadow-[0_2px_24px_-12px_rgba(15,23,42,0.12)]">
            <CardHeader className="space-y-3 pb-2">
              <CardTitle className="font-display text-xl font-normal tracking-tight sm:text-2xl">
                Connect a wallet
              </CardTitle>
              <CardDescription className="text-[15px] leading-relaxed">
                Use an Ethereum mainnet wallet to sign payloads. No API keys—only your signature.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center pb-10 pt-4">
              <WalletConnect />
            </CardContent>
          </Card>
        ) : view === 'publish' ? extensionsEnabled ? (
          <Tabs
            value={publishTab}
            onValueChange={(v) => {
              setPublishTab(v as PublishTab)
              if (v !== 'channel') {
                setPendingChannelPlaylistsText(undefined)
              }
            }}
            className="w-full"
          >
            <TabsList className="grid h-12 w-full max-w-xl grid-cols-3 gap-1 rounded-full bg-muted/60 p-1.5 sm:h-11">
              <TabsTrigger
                value="playlist"
                className="gap-1 rounded-full px-2 text-[11px] font-medium data-[state=active]:shadow-sm sm:gap-2 sm:px-4 sm:text-[13px]"
              >
                <ListMusic className="size-3.5 opacity-70 sm:size-4" aria-hidden />
                Playlist
              </TabsTrigger>
              <TabsTrigger
                value="group"
                className="gap-1 rounded-full px-2 text-[11px] font-medium data-[state=active]:shadow-sm sm:gap-2 sm:px-4 sm:text-[13px]"
              >
                <Layers className="size-3.5 opacity-70 sm:size-4" aria-hidden />
                Group
              </TabsTrigger>
              <TabsTrigger
                value="channel"
                className="gap-1 rounded-full px-2 text-[11px] font-medium data-[state=active]:shadow-sm sm:gap-2 sm:px-4 sm:text-[13px]"
              >
                <Radio className="size-3.5 opacity-70 sm:size-4" aria-hidden />
                Channel
              </TabsTrigger>
            </TabsList>

            <TabsContent value="playlist" className="mt-10 outline-none">
              <PlaylistForm
                extensionsEnabled
                onPublished={bumpPublished}
                onUseInNewChannel={handleUseInNewChannel}
                existingChannels={existingChannels}
                onAddToExistingChannel={handleAddToExistingChannel}
                onViewPublished={handleViewPublished}
              />
            </TabsContent>

            <TabsContent value="group" className="mt-10 outline-none">
              <PlaylistGroupForm
                onPublished={bumpPublished}
                onViewPublished={handleViewPublished}
              />
            </TabsContent>

            <TabsContent value="channel" className="mt-10 outline-none">
              <ChannelForm
                key={pendingChannelPlaylistsText ?? 'new-channel'}
                initialPlaylistsText={pendingChannelPlaylistsText}
                onPublished={bumpPublished}
                onViewPublished={handleViewPublished}
              />
            </TabsContent>
          </Tabs>
        ) : (
          <Tabs
            value={publishTab === 'channel' ? 'playlist' : publishTab}
            onValueChange={(v) => setPublishTab(v as PublishTab)}
            className="w-full"
          >
            <TabsList className="grid h-12 w-full max-w-md grid-cols-2 gap-1 rounded-full bg-muted/60 p-1.5 sm:h-11">
              <TabsTrigger
                value="playlist"
                className="gap-2 rounded-full px-4 text-[13px] font-medium data-[state=active]:shadow-sm"
              >
                <ListMusic className="size-4 opacity-70" aria-hidden />
                Playlist
              </TabsTrigger>
              <TabsTrigger
                value="group"
                className="gap-2 rounded-full px-4 text-[13px] font-medium data-[state=active]:shadow-sm"
              >
                <Layers className="size-4 opacity-70" aria-hidden />
                Group
              </TabsTrigger>
            </TabsList>

            <TabsContent value="playlist" className="mt-10 outline-none">
              <PlaylistForm
                extensionsEnabled={false}
                onPublished={bumpPublished}
                onViewPublished={handleViewPublished}
              />
            </TabsContent>

            <TabsContent value="group" className="mt-10 outline-none">
              <PlaylistGroupForm
                onPublished={bumpPublished}
                onViewPublished={handleViewPublished}
              />
            </TabsContent>
          </Tabs>
        ) : editPlaylistId ? (
          <PlaylistForm
            key={editPlaylistId}
            editId={editPlaylistId}
            extensionsEnabled={extensionsEnabled}
            onCancelEdit={() => {
              setEditPlaylistId(null)
              bumpPublished()
            }}
            onPublished={bumpPublished}
          />
        ) : editPlaylistGroupId ? (
          <PlaylistGroupForm
            key={editPlaylistGroupId}
            editId={editPlaylistGroupId}
            onCancelEdit={() => {
              setEditPlaylistGroupId(null)
              bumpPublished()
            }}
            onPublished={bumpPublished}
          />
        ) : editChannelId && extensionsEnabled ? (
          <ChannelForm
            key={`${editChannelId}:${pendingAppendPlaylistUrl ?? ''}`}
            editId={editChannelId}
            appendPlaylistUrl={pendingAppendPlaylistUrl}
            onCancelEdit={() => {
              setEditChannelId(null)
              setPendingAppendPlaylistUrl(undefined)
              bumpPublished()
            }}
            onPublished={() => {
              setPendingAppendPlaylistUrl(undefined)
              bumpPublished()
            }}
          />
        ) : (
          <PublishedView
            key={publishedTick}
            extensionsEnabled={extensionsEnabled}
            onEditPlaylist={(id) => {
              setEditPlaylistGroupId(null)
              setEditChannelId(null)
              setEditPlaylistId(id)
            }}
            onEditPlaylistGroup={(id) => {
              setEditPlaylistId(null)
              setEditChannelId(null)
              setEditPlaylistGroupId(id)
            }}
            onEditChannel={(id) => {
              setEditPlaylistId(null)
              setEditPlaylistGroupId(null)
              setEditChannelId(id)
            }}
          />
        )}
      </div>
      <Toaster />
    </>
  )
}
