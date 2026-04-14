import { useState } from 'react'
import { useAccount } from 'wagmi'
import { ListMusic, Radio } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Toaster } from '@/components/ui/toaster'
import WalletConnect from './WalletConnect'
import PlaylistForm from './PlaylistForm'
import ChannelForm from './ChannelForm'
import PublishedView from './PublishedView'

export default function Dashboard() {
  const { isConnected } = useAccount()
  const [view, setView] = useState<'publish' | 'published'>('publish')
  const [publishedTick, setPublishedTick] = useState(0)
  const [editPlaylistId, setEditPlaylistId] = useState<string | null>(null)
  const [editChannelId, setEditChannelId] = useState<string | null>(null)

  const bumpPublished = () => setPublishedTick((n) => n + 1)

  return (
    <>
      <div className="relative mx-auto max-w-3xl px-5 py-14 sm:px-8 sm:py-20">
        <header className="mb-14 flex flex-col gap-8 sm:mb-16 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-4">
            <p className="section-label">Display Protocol</p>
            <div className="space-y-3">
              <h1 className="font-display text-[2rem] font-normal leading-[1.15] tracking-tight text-foreground sm:text-4xl">
                Publisher
              </h1>
              <p className="max-w-sm text-[15px] leading-relaxed text-muted-foreground">
                Sign and publish playlists and channels to the feed.
              </p>
            </div>
          </div>
          {isConnected ? (
            <div className="shrink-0 sm:pt-1">
              <WalletConnect
                onNavigatePublish={() => {
                  setEditPlaylistId(null)
                  setEditChannelId(null)
                  setView('publish')
                }}
                onNavigatePublished={() => setView('published')}
                activeSection={view}
              />
            </div>
          ) : null}
        </header>

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
        ) : view === 'publish' ? (
          <Tabs defaultValue="playlist" className="w-full">
            <TabsList className="grid h-12 w-full max-w-md grid-cols-2 gap-1 rounded-full bg-muted/60 p-1.5 sm:h-11">
              <TabsTrigger
                value="playlist"
                className="gap-2 rounded-full px-4 text-[13px] font-medium data-[state=active]:shadow-sm"
              >
                <ListMusic className="size-4 opacity-70" aria-hidden />
                Playlist
              </TabsTrigger>
              <TabsTrigger
                value="channel"
                className="gap-2 rounded-full px-4 text-[13px] font-medium data-[state=active]:shadow-sm"
              >
                <Radio className="size-4 opacity-70" aria-hidden />
                Channel
              </TabsTrigger>
            </TabsList>

            <TabsContent value="playlist" className="mt-10 outline-none">
              <PlaylistForm onPublished={bumpPublished} />
            </TabsContent>

            <TabsContent value="channel" className="mt-10 outline-none">
              <ChannelForm onPublished={bumpPublished} />
            </TabsContent>
          </Tabs>
        ) : editPlaylistId ? (
          <PlaylistForm
            key={editPlaylistId}
            editId={editPlaylistId}
            onCancelEdit={() => {
              setEditPlaylistId(null)
              bumpPublished()
            }}
            onPublished={bumpPublished}
          />
        ) : editChannelId ? (
          <ChannelForm
            key={editChannelId}
            editId={editChannelId}
            onCancelEdit={() => {
              setEditChannelId(null)
              bumpPublished()
            }}
            onPublished={bumpPublished}
          />
        ) : (
          <PublishedView
            key={publishedTick}
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
