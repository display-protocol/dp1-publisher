import { useEffect, useMemo, useState } from 'react'
import { useAccount } from 'wagmi'
import { History, ListMusic, Radio, Upload } from 'lucide-react'
import {
  entityNavListClass,
  entityNavTriggerCompactClass,
  sectionTabButtonActiveClass,
  sectionTabButtonClass,
  sectionTabButtonInactiveClass,
  sectionTabsInlineListClass,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Toaster } from '@/components/ui/toaster'
import { cn } from '@/lib/utils'
import { useDp1Extensions } from '@/context/Dp1ExtensionsContext'
import { loadPublished, sortByCreatedDesc } from '@/lib/publishedStorage'
import WalletConnect from './WalletConnect'
import PlaylistForm from './PlaylistForm'
import ChannelForm from './ChannelForm'
import PublishedView from './PublishedView'

type PublishTab = 'playlist' | 'channel'

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
    setEditChannelId(null)
    setPendingAppendPlaylistUrl(undefined)
    // Clear the new-channel pre-fill too — otherwise navigating away from
    // the channel form (to Published, or to another publish subtab) and
    // back can remount it with a stale playlist URL silently pre-seeded,
    // which the user could then publish without realizing.
    setPendingChannelPlaylistsText(undefined)
  }

  const handleUseInNewChannel = (feedUrl: string) => {
    setPendingChannelPlaylistsText(feedUrl)
    setPendingAppendPlaylistUrl(undefined)
    setPublishTab('channel')
    setView('publish')
    setEditPlaylistId(null)
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
              <p className="text-sm text-muted-foreground">
                Already have a signed-ready document from ff-cli or an agent?{' '}
                <a
                  href="#/sign"
                  className="text-foreground underline underline-offset-4 hover:opacity-70"
                >
                  Review &amp; sign it
                </a>
                .
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
              className={sectionTabsInlineListClass}
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
                  sectionTabButtonClass,
                  view === 'publish'
                    ? sectionTabButtonActiveClass
                    : sectionTabButtonInactiveClass,
                )}
              >
                <Upload className="size-3.5 opacity-70 sm:size-4" aria-hidden />
                Publish
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'published'}
                onClick={handleViewPublished}
                className={cn(
                  sectionTabButtonClass,
                  view === 'published'
                    ? sectionTabButtonActiveClass
                    : sectionTabButtonInactiveClass,
                )}
              >
                <History className="size-3.5 opacity-70 sm:size-4" aria-hidden />
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
            <TabsList className={entityNavListClass}>
              <TabsTrigger value="playlist" className={entityNavTriggerCompactClass}>
                <ListMusic className="size-3.5 opacity-70 sm:size-4" aria-hidden />
                Playlist
              </TabsTrigger>
              <TabsTrigger value="channel" className={entityNavTriggerCompactClass}>
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
          /* Core-only deployments can compose playlists and nothing else. */
          <PlaylistForm
            extensionsEnabled={false}
            onPublished={bumpPublished}
            onViewPublished={handleViewPublished}
          />
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
              setEditChannelId(null)
              setEditPlaylistId(id)
            }}
            onEditChannel={(id) => {
              setEditPlaylistId(null)
              setEditChannelId(id)
            }}
          />
        )}
      </div>
      <Toaster />
    </>
  )
}
