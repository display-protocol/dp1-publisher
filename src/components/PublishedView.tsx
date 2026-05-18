import { useCallback, useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { ListMusic, Radio } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { feedChannelResourceUrl, feedPlaylistResourceUrl } from '@/lib/api'
import { loadPublished, sortByCreatedDesc, type PublishedRecord } from '@/lib/publishedStorage'

function formatWhen(iso?: string): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  return new Date(t).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export default function PublishedView({
  extensionsEnabled,
  onEditPlaylist,
  onEditChannel,
}: {
  extensionsEnabled: boolean
  onEditPlaylist: (id: string) => void
  onEditChannel: (id: string) => void
}) {
  const { address } = useAccount()
  const [playlists, setPlaylists] = useState<PublishedRecord[]>([])
  const [channels, setChannels] = useState<PublishedRecord[]>([])

  const reloadFromStorage = useCallback(() => {
    if (!address) {
      setPlaylists([])
      setChannels([])
      return
    }
    const b = loadPublished(address)
    setPlaylists(sortByCreatedDesc(b.playlists))
    setChannels(sortByCreatedDesc(b.channels))
  }, [address])

  useEffect(() => {
    reloadFromStorage()
  }, [reloadFromStorage])

  if (!address) {
    return null
  }

  return (
    <Card className="border-border/45 shadow-[0_2px_40px_-20px_rgba(15,23,42,0.15)]">
      <CardHeader className="space-y-2 pb-4">
        <p className="section-label">Published</p>
        <div className="space-y-1">
          <CardTitle className="font-display text-2xl font-normal sm:text-[1.75rem]">
            {extensionsEnabled ? 'Your playlists & channels' : 'Your playlists'}
          </CardTitle>
          <CardDescription className="text-[15px]">
            {extensionsEnabled
              ? 'Entries saved in this browser when you publish from here. Sorted by created time (newest first).'
              : 'Entries saved in this browser when you publish playlists from here. Sorted by created time (newest first).'}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="pb-8">
        {extensionsEnabled ? (
          <Tabs defaultValue="playlist" className="w-full">
            <TabsList className="grid h-12 w-full max-w-md grid-cols-2 gap-1 rounded-full bg-muted/60 p-1.5 sm:h-11">
              <TabsTrigger
                value="playlist"
                className="gap-2 rounded-full px-4 text-[13px] font-medium data-[state=active]:shadow-sm"
              >
                <ListMusic className="size-4 opacity-70" aria-hidden />
                Playlists
              </TabsTrigger>
              <TabsTrigger
                value="channel"
                className="gap-2 rounded-full px-4 text-[13px] font-medium data-[state=active]:shadow-sm"
              >
                <Radio className="size-4 opacity-70" aria-hidden />
                Channels
              </TabsTrigger>
            </TabsList>

            <TabsContent value="playlist" className="mt-8 outline-none">
              <PublishedTable
                rows={playlists}
                empty="No playlists recorded yet. Publish one from the Publish screen."
                onRowClick={(r) => onEditPlaylist(r.id)}
                feedResourceUrl={(r) =>
                  feedPlaylistResourceUrl(r.slug?.trim() || r.id)
                }
              />
            </TabsContent>

            <TabsContent value="channel" className="mt-8 outline-none">
              <PublishedTable
                rows={channels}
                empty="No channels recorded yet. Publish one from the Publish screen."
                onRowClick={(r) => onEditChannel(r.id)}
                feedResourceUrl={(r) =>
                  feedChannelResourceUrl(r.slug?.trim() || r.id)
                }
              />
            </TabsContent>
          </Tabs>
        ) : (
          <div className="mt-8">
            <PublishedTable
              rows={playlists}
              empty="No playlists recorded yet. Publish one from the Publish screen."
              onRowClick={(r) => onEditPlaylist(r.id)}
              feedResourceUrl={(r) =>
                feedPlaylistResourceUrl(r.slug?.trim() || r.id)
              }
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function PublishedTable({
  rows,
  empty,
  onRowClick,
  feedResourceUrl,
}: {
  rows: PublishedRecord[]
  empty: string
  onRowClick: (r: PublishedRecord) => void
  feedResourceUrl: (r: PublishedRecord) => string
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border/60 bg-muted/10 px-4 py-10 text-center text-[15px] text-muted-foreground">
        {empty}
      </p>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border/50">
      <table className="w-full text-left text-[14px]">
        <thead>
          <tr className="border-b border-border/50 bg-muted/25 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-3 font-medium">Title</th>
            <th className="hidden px-4 py-3 font-medium sm:table-cell">Feed URL</th>
            <th className="px-4 py-3 font-medium">Created</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className="cursor-pointer border-b border-border/40 transition-colors last:border-0 hover:bg-muted/20"
              onClick={() => onRowClick(r)}
            >
              <td className="max-w-[200px] px-4 py-3 font-medium text-foreground sm:max-w-none">
                <div className="truncate sm:max-w-none">{r.title || '—'}</div>
                <a
                  href={feedResourceUrl(r)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 hidden max-w-full font-mono text-[11px] font-normal leading-snug text-primary underline underline-offset-2 [word-break:break-all] max-[639px]:block hover:text-primary/90"
                  onClick={(e) => e.stopPropagation()}
                >
                  {feedResourceUrl(r)}
                </a>
              </td>
              <td className="hidden max-w-[min(28rem,50vw)] px-4 py-3 align-top sm:table-cell">
                <a
                  href={feedResourceUrl(r)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[12px] text-primary underline underline-offset-2 [word-break:break-all] hover:text-primary/90"
                  onClick={(e) => e.stopPropagation()}
                >
                  {feedResourceUrl(r)}
                </a>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                {formatWhen(r.created)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
