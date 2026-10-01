import { useAccount } from 'wagmi'
import { ListMusic, Radio } from 'lucide-react'
import {
  entityNavListClass,
  entityNavTriggerCompactClass,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  feedChannelResourceUrl,
  feedPlaylistResourceUrl,
} from '@/lib/api'
import {
  flattenOwnedPages,
  useOwnedChannels,
  useOwnedPlaylists,
} from '@/hooks/useOwnedDocuments'

/** List fields shared by feed playlists and channels. */
type PublishedRow = { id: string; slug?: string; title: string; created?: string }

/** The subset of a `useInfiniteQuery` result the table needs. */
type OwnedListState = {
  isPending: boolean
  isError: boolean
  error: unknown
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => unknown
  refetch: () => unknown
}

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
  const playlistsQuery = useOwnedPlaylists(address)
  const channelsQuery = useOwnedChannels(address, extensionsEnabled)
  const playlists = flattenOwnedPages(playlistsQuery.data)
  const channels = flattenOwnedPages(channelsQuery.data)

  if (!address) {
    return null
  }

  const titleHeading = extensionsEnabled ? 'Your playlists & channels' : 'Your playlists'

  const titleDescription = extensionsEnabled
    ? 'Playlists listing your wallet as curator and channels it publishes, as the feed has them. Newest first.'
    : 'Playlists listing your wallet as curator, as the feed has them. Newest first.'

  return (
    <Card className="border-border/45 shadow-[0_2px_40px_-20px_rgba(15,23,42,0.15)]">
      <CardHeader className="space-y-2 pb-4">
        <p className="section-label">Published</p>
        <div className="space-y-1">
          <CardTitle className="font-display text-2xl font-normal sm:text-[1.75rem]">{titleHeading}</CardTitle>
          <CardDescription className="text-[15px]">{titleDescription}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="pb-8">
        {extensionsEnabled ? (
          <Tabs defaultValue="playlist" className="w-full">
            <TabsList className={entityNavListClass}>
              <TabsTrigger value="playlist" className={entityNavTriggerCompactClass}>
                <ListMusic className="size-3.5 opacity-70 sm:size-4" aria-hidden />
                Playlists
              </TabsTrigger>
              <TabsTrigger value="channel" className={entityNavTriggerCompactClass}>
                <Radio className="size-3.5 opacity-70 sm:size-4" aria-hidden />
                Channels
              </TabsTrigger>
            </TabsList>

            <TabsContent value="playlist" className="mt-8 outline-none">
              <PublishedTable
                rows={playlists}
                query={playlistsQuery}
                noun="playlists"
                empty="No playlists yet. Publish one from the Publish screen."
                onRowClick={(r) => onEditPlaylist(r.id)}
                feedResourceUrl={(r) =>
                  feedPlaylistResourceUrl(r.slug?.trim() || r.id)
                }
              />
            </TabsContent>

            <TabsContent value="channel" className="mt-8 outline-none">
              <PublishedTable
                rows={channels}
                query={channelsQuery}
                noun="channels"
                empty="No channels yet. Publish one from the Publish screen."
                onRowClick={(r) => onEditChannel(r.id)}
                feedResourceUrl={(r) =>
                  feedChannelResourceUrl(r.slug?.trim() || r.id)
                }
              />
            </TabsContent>
          </Tabs>
        ) : (
          // Core-only deployments publish playlists and nothing else, so there
          // is no second list to tab between.
          <PublishedTable
            rows={playlists}
            query={playlistsQuery}
            noun="playlists"
            empty="No playlists yet. Publish one from the Publish screen."
            onRowClick={(r) => onEditPlaylist(r.id)}
            feedResourceUrl={(r) => feedPlaylistResourceUrl(r.slug?.trim() || r.id)}
          />
        )}
      </CardContent>
    </Card>
  )
}

const placeholderClass =
  'rounded-xl border border-dashed border-border/60 bg-muted/10 px-4 py-10 text-center text-[15px] text-muted-foreground'

function PublishedTable({
  rows,
  query,
  noun,
  empty,
  onRowClick,
  feedResourceUrl,
}: {
  rows: PublishedRow[]
  query: OwnedListState
  noun: string
  empty: string
  onRowClick: (r: PublishedRow) => void
  feedResourceUrl: (r: PublishedRow) => string
}) {
  if (query.isPending) {
    return <p className={placeholderClass}>Loading your {noun} from the feed…</p>
  }

  if (query.isError && rows.length === 0) {
    const reason = query.error instanceof Error ? query.error.message : 'Unknown error'
    return (
      <div className={placeholderClass}>
        <p>Could not load your {noun} from the feed: {reason}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => void query.refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        // Can still have a next page: the owner guard in useOwnedDocuments may empty a whole page.
        <p className={placeholderClass}>{empty}</p>
      ) : (
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
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatWhen(r.created)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {query.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? 'Loading…' : `Load more ${noun}`}
          </Button>
        </div>
      ) : null}
      {query.isError ? (
        <p className="text-center text-sm text-destructive">The feed request failed, so this list may be incomplete or out of date.</p>
      ) : null}
    </div>
  )
}
