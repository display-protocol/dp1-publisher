/**
 * The connected wallet's published playlists and channels, read from the feed.
 *
 * The feed is the only source: these lists follow the wallet across browsers and devices, and they
 * reflect edits or deletes made by any tool. Rows are full feed documents, but they are list data
 * only — edit flows still GET the resource before building a replace, so a stale page can never
 * become the merge base for a PUT (a replace sends the whole document).
 *
 * Matching rule (dp1-feed-v2 `GET /playlists?curator=` / `GET /channels?publisher=`): the feed
 * matches the key the document *declares* (`curators[].key` / `publisher.key`), exactly and
 * case-sensitively. Every publish from this app declares the wallet's checksummed did:pkh there
 * (`dp1WalletSigner.ts`), so everything it publishes is listed. Documents that only carry the
 * wallet's owner-role signature without declaring it, or declare it in another letter case, are not
 * listed — that is the feed's attribution semantics, not something this client can widen.
 */

import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { useCallback } from 'react'
import { FeedAPIError, listChannels, listPlaylists, type FeedListResponse } from '@/lib/api'
import type { Channel, Playlist } from '@/types/dp1'
import { ethereumAddressToDIDPKH } from '@/lib/signing'

/** Prefix shared by every owned-documents query; invalidate it after any publish or replace. */
const OWNED_DOCUMENTS_KEY = ['owned-documents'] as const

/** Page size per request. List items are full documents (playlists include `items`), so stay below the feed's 100 max. */
const PAGE_SIZE = 50

function ownerDidFor(address: string | undefined): string | undefined {
  return address ? ethereumAddressToDIDPKH(address) : undefined
}

function nextCursor<T>(page: FeedListResponse<T>): string | undefined {
  return page.hasMore ? page.cursor : undefined
}

/**
 * A 4xx is deterministic (e.g. 404 on a core-only feed, 400 on a bad cursor); retrying only delays
 * the error state. Network failures and 5xx get one retry.
 */
function retryTransient(failureCount: number, error: unknown): boolean {
  if (error instanceof FeedAPIError && error.status >= 400 && error.status < 500) return false
  return failureCount < 1
}

/**
 * Re-apply the owner filter client-side. A feed that predates the `curator` / `publisher` query
 * params ignores them and returns every document, which would list (and offer in pickers) documents
 * this wallet does not own. On a current feed the match is the same exact comparison, so this
 * removes nothing. A page may therefore come back short or empty while `hasMore` is still true.
 */
function keepOwnedPlaylists(
  page: FeedListResponse<Playlist>,
  ownerDid: string
): FeedListResponse<Playlist> {
  return { ...page, items: page.items.filter((p) => p.curators?.some((c) => c?.key === ownerDid)) }
}

function keepOwnedChannels(
  page: FeedListResponse<Channel>,
  ownerDid: string
): FeedListResponse<Channel> {
  return { ...page, items: page.items.filter((c) => c.publisher?.key === ownerDid) }
}

/** Flatten loaded pages, dropping rows without an `id` (they cannot be opened for edit). */
export function flattenOwnedPages<T extends { id?: string }>(
  data: InfiniteData<FeedListResponse<T>> | undefined
): (T & { id: string })[] {
  if (!data) return []
  return data.pages.flatMap((p) => p.items).filter((d): d is T & { id: string } => !!d.id)
}

/** Playlists declaring the wallet in `curators[]`, newest first. */
export function useOwnedPlaylists(address: string | undefined) {
  const ownerDid = ownerDidFor(address)
  return useInfiniteQuery({
    queryKey: [...OWNED_DOCUMENTS_KEY, 'playlists', ownerDid],
    queryFn: async ({ pageParam }) =>
      keepOwnedPlaylists(
        await listPlaylists({ curator: ownerDid, sort: 'desc', limit: PAGE_SIZE, cursor: pageParam }),
        ownerDid as string
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    retry: retryTransient,
    enabled: !!ownerDid,
  })
}

/**
 * Channels whose `publisher.key` is the wallet, newest first. Filters on the owner (`publisher`), not
 * on `curators[]`, which for channels is attribution only and could list channels the wallet cannot edit.
 * Pass `enabled: false` on core-only deployments, where the channels endpoint 404s.
 */
export function useOwnedChannels(address: string | undefined, enabled: boolean) {
  const ownerDid = ownerDidFor(address)
  return useInfiniteQuery({
    queryKey: [...OWNED_DOCUMENTS_KEY, 'channels', ownerDid],
    queryFn: async ({ pageParam }) =>
      keepOwnedChannels(
        await listChannels({ publisher: ownerDid, sort: 'desc', limit: PAGE_SIZE, cursor: pageParam }),
        ownerDid as string
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    retry: retryTransient,
    enabled: enabled && !!ownerDid,
  })
}

/** Returns a callback that refetches every owned-documents list (call after publish/replace). */
export function useInvalidateOwnedDocuments(): () => void {
  const queryClient = useQueryClient()
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: OWNED_DOCUMENTS_KEY })
  }, [queryClient])
}
