import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import PublishedView from './PublishedView'
import * as apiModule from '@/lib/api'
import { ethereumAddressToDIDPKH } from '@/lib/signing'
import { renderWithQueryClient as render } from '@/test/renderWithQueryClient'
import type { Channel, Playlist } from '@/types/dp1'

const WALLET = '0x000000000000000000000000000000000000aBcD'
const WALLET_DID = ethereumAddressToDIDPKH(WALLET)
const OTHER_DID = ethereumAddressToDIDPKH('0x0000000000000000000000000000000000001234')

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: '0x000000000000000000000000000000000000aBcD' }),
}))

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof apiModule>('@/lib/api')
  return { ...actual, listPlaylists: vi.fn(), listChannels: vi.fn() }
})

const mockedApi = apiModule as typeof apiModule & {
  listPlaylists: ReturnType<typeof vi.fn>
  listChannels: ReturnType<typeof vi.fn>
}

function playlist(id: string, title: string, curatorKey = WALLET_DID): Playlist {
  return {
    dpVersion: '1.1.0',
    id,
    slug: `${id}-slug`,
    title,
    items: [],
    curators: [{ name: '', key: curatorKey }],
  }
}

function channel(id: string, title: string, publisherKey = WALLET_DID): Channel {
  return {
    version: '0.1.0',
    id,
    slug: `${id}-slug`,
    title,
    playlists: [],
    publisher: { name: '', key: publisherKey },
  }
}

const noop = () => {}

describe('PublishedView — feed-backed lists', () => {
  beforeEach(() => {
    mockedApi.listPlaylists.mockReset()
    mockedApi.listChannels.mockReset()
    mockedApi.listChannels.mockResolvedValue({ items: [], hasMore: false })
  })

  it('queries playlists by the wallet curator DID and lists them', async () => {
    mockedApi.listPlaylists.mockResolvedValue({ items: [playlist('p1', 'First')], hasMore: false })

    render(<PublishedView extensionsEnabled={false} onEditPlaylist={noop} onEditChannel={noop} />)

    expect(await screen.findByText('First')).toBeInTheDocument()
    expect(mockedApi.listPlaylists).toHaveBeenCalledWith(
      expect.objectContaining({ curator: WALLET_DID, sort: 'desc', cursor: undefined })
    )
  })

  it('does not request channels when extensions are off', async () => {
    mockedApi.listPlaylists.mockResolvedValue({ items: [], hasMore: false })

    render(<PublishedView extensionsEnabled={false} onEditPlaylist={noop} onEditChannel={noop} />)

    expect(await screen.findByText(/No playlists yet/)).toBeInTheDocument()
    expect(mockedApi.listChannels).not.toHaveBeenCalled()
  })

  it('queries channels by publisher DID and opens the clicked row for edit', async () => {
    mockedApi.listPlaylists.mockResolvedValue({ items: [], hasMore: false })
    mockedApi.listChannels.mockResolvedValue({ items: [channel('c1', 'My channel')], hasMore: false })
    const onEditChannel = vi.fn()

    render(<PublishedView extensionsEnabled onEditPlaylist={noop} onEditChannel={onEditChannel} />)
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Channels/ }))
    fireEvent.click(await screen.findByText('My channel'))

    expect(onEditChannel).toHaveBeenCalledWith('c1')
    expect(mockedApi.listChannels).toHaveBeenCalledWith(
      expect.objectContaining({ publisher: WALLET_DID, sort: 'desc' })
    )
  })

  it('pages with the feed cursor via "Load more"', async () => {
    mockedApi.listPlaylists
      .mockResolvedValueOnce({ items: [playlist('p1', 'Newest')], hasMore: true, cursor: 'next-1' })
      .mockResolvedValueOnce({ items: [playlist('p2', 'Older')], hasMore: false })

    render(<PublishedView extensionsEnabled={false} onEditPlaylist={noop} onEditChannel={noop} />)
    fireEvent.click(await screen.findByRole('button', { name: /Load more playlists/ }))

    expect(await screen.findByText('Older')).toBeInTheDocument()
    expect(screen.getByText('Newest')).toBeInTheDocument()
    expect(mockedApi.listPlaylists).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'next-1' })
    )
    expect(screen.queryByRole('button', { name: /Load more/ })).not.toBeInTheDocument()
  })

  it('drops rows the feed returned for other owners (feed that ignores the filter)', async () => {
    mockedApi.listPlaylists.mockResolvedValue({
      items: [playlist('p1', 'Mine'), playlist('p2', 'Someone else', OTHER_DID)],
      hasMore: false,
    })

    render(<PublishedView extensionsEnabled={false} onEditPlaylist={noop} onEditChannel={noop} />)

    expect(await screen.findByText('Mine')).toBeInTheDocument()
    expect(screen.queryByText('Someone else')).not.toBeInTheDocument()
  })

  it('still offers "Load more" when the owner guard empties a page', async () => {
    mockedApi.listPlaylists
      .mockResolvedValueOnce({
        items: [playlist('p9', 'Not mine', OTHER_DID)],
        hasMore: true,
        cursor: 'next-1',
      })
      .mockResolvedValueOnce({ items: [playlist('p1', 'Mine')], hasMore: false })

    render(<PublishedView extensionsEnabled={false} onEditPlaylist={noop} onEditChannel={noop} />)
    expect(await screen.findByText(/No playlists yet/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Load more playlists/ }))

    expect(await screen.findByText('Mine')).toBeInTheDocument()
  })

  it('shows a 4xx feed error without retrying, and "Try again" refetches', async () => {
    mockedApi.listPlaylists
      .mockRejectedValueOnce(new apiModule.FeedAPIError('feed is down', 404))
      .mockResolvedValue({ items: [playlist('p1', 'Recovered')], hasMore: false })

    render(<PublishedView extensionsEnabled={false} onEditPlaylist={noop} onEditChannel={noop} />)

    expect(await screen.findByText(/Could not load your playlists from the feed: feed is down/)).toBeInTheDocument()
    expect(mockedApi.listPlaylists).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }))
    expect(await screen.findByText('Recovered')).toBeInTheDocument()
  })

  it('keeps loaded rows and flags the list when a later page fails', async () => {
    mockedApi.listPlaylists
      .mockResolvedValueOnce({ items: [playlist('p1', 'Loaded')], hasMore: true, cursor: 'next-1' })
      .mockRejectedValueOnce(new apiModule.FeedAPIError('bad cursor', 400))

    render(<PublishedView extensionsEnabled={false} onEditPlaylist={noop} onEditChannel={noop} />)
    fireEvent.click(await screen.findByRole('button', { name: /Load more playlists/ }))

    await waitFor(() => {
      expect(screen.getByText(/list may be incomplete/)).toBeInTheDocument()
    })
    expect(screen.getByText('Loaded')).toBeInTheDocument()
  })
})
