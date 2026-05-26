import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PostPublishPanel from '@/components/PostPublishPanel'

describe('PostPublishPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the kind-specific headline and the feed URL', () => {
    render(
      <PostPublishPanel
        kind="playlist"
        feedUrl="https://feed.example/api/v1/playlists/season-1"
        title="OCCUPY Season 1"
        onPublishAnother={() => undefined}
        onViewPublished={() => undefined}
      />,
    )
    expect(screen.getByText('Playlist published')).toBeTruthy()
    expect(screen.getByText(/OCCUPY Season 1/)).toBeTruthy()
    const url = screen.getByDisplayValue(
      'https://feed.example/api/v1/playlists/season-1',
    )
    expect(url).toBeTruthy()
    expect((url as HTMLInputElement).readOnly).toBe(true)
  })

  it('only renders "Start a new channel" when onUseInNewChannel is provided', () => {
    const { rerender } = render(
      <PostPublishPanel
        kind="playlist"
        feedUrl="https://feed.example/api/v1/playlists/x"
        onPublishAnother={() => undefined}
        onViewPublished={() => undefined}
      />,
    )
    expect(
      screen.queryByRole('button', { name: /Start a new channel/ }),
    ).toBeNull()

    rerender(
      <PostPublishPanel
        kind="playlist"
        feedUrl="https://feed.example/api/v1/playlists/x"
        onUseInNewChannel={() => undefined}
        onPublishAnother={() => undefined}
        onViewPublished={() => undefined}
      />,
    )
    expect(
      screen.getByRole('button', { name: /Start a new channel/ }),
    ).toBeTruthy()
  })

  it('renders one "Add to: <title>" button per existing channel and fires with the right id', () => {
    const onAddToExistingChannel = vi.fn()
    render(
      <PostPublishPanel
        kind="playlist"
        feedUrl="https://feed.example/api/v1/playlists/x"
        onUseInNewChannel={() => undefined}
        existingChannels={[
          { id: 'occupy-id', title: 'OCCUPY' },
          { id: 'picks-id', title: 'NODE Picks' },
        ]}
        onAddToExistingChannel={onAddToExistingChannel}
        onPublishAnother={() => undefined}
        onViewPublished={() => undefined}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Add to: OCCUPY/ }))
    expect(onAddToExistingChannel).toHaveBeenCalledWith('occupy-id')
    fireEvent.click(screen.getByRole('button', { name: /Add to: NODE Picks/ }))
    expect(onAddToExistingChannel).toHaveBeenCalledWith('picks-id')
  })

  it('only shows the channel-playlists[] paste hint for playlist publishes', () => {
    const { rerender } = render(
      <PostPublishPanel
        kind="playlist"
        feedUrl="https://feed.example/api/v1/playlists/x"
        onPublishAnother={() => undefined}
        onViewPublished={() => undefined}
      />,
    )
    expect(
      screen.getByText(/Paste this URL into a channel's/i),
    ).toBeTruthy()

    rerender(
      <PostPublishPanel
        kind="channel"
        feedUrl="https://feed.example/api/v1/channels/x"
        onPublishAnother={() => undefined}
        onViewPublished={() => undefined}
      />,
    )
    expect(screen.queryByText(/Paste this URL into a channel's/i)).toBeNull()

    rerender(
      <PostPublishPanel
        kind="playlist-group"
        feedUrl="https://feed.example/api/v1/playlist-groups/x"
        onPublishAnother={() => undefined}
        onViewPublished={() => undefined}
      />,
    )
    expect(screen.queryByText(/Paste this URL into a channel's/i)).toBeNull()
  })

  it('hides the channel-CTA section entirely for non-playlist kinds', () => {
    render(
      <PostPublishPanel
        kind="channel"
        feedUrl="https://feed.example/api/v1/channels/x"
        onUseInNewChannel={() => undefined}
        existingChannels={[{ id: 'a', title: 'A' }]}
        onAddToExistingChannel={() => undefined}
        onPublishAnother={() => undefined}
        onViewPublished={() => undefined}
      />,
    )
    expect(screen.queryByText(/Use this playlist in a channel/)).toBeNull()
    expect(
      screen.queryByRole('button', { name: /Start a new channel/ }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: /Add to: A/ }),
    ).toBeNull()
  })

  it('fires the right callbacks on each CTA', () => {
    const onUseInNewChannel = vi.fn()
    const onPublishAnother = vi.fn()
    const onViewPublished = vi.fn()
    render(
      <PostPublishPanel
        kind="playlist"
        feedUrl="https://feed.example/api/v1/playlists/x"
        onUseInNewChannel={onUseInNewChannel}
        onPublishAnother={onPublishAnother}
        onViewPublished={onViewPublished}
      />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: /Start a new channel/ }),
    )
    fireEvent.click(screen.getByRole('button', { name: /Publish another/ }))
    fireEvent.click(screen.getByRole('button', { name: /View all published/ }))
    expect(onUseInNewChannel).toHaveBeenCalledTimes(1)
    expect(onPublishAnother).toHaveBeenCalledTimes(1)
    expect(onViewPublished).toHaveBeenCalledTimes(1)
  })

  it('copies the feed URL and flips the button label briefly', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    render(
      <PostPublishPanel
        kind="channel"
        feedUrl="https://feed.example/api/v1/channels/occupy"
        onPublishAnother={() => undefined}
        onViewPublished={() => undefined}
      />,
    )
    const copyButton = screen.getByRole('button', { name: /Copy feed URL/ })
    fireEvent.click(copyButton)
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        'https://feed.example/api/v1/channels/occupy',
      )
      expect(
        screen.getByRole('button', { name: /Copy feed URL/ }).textContent,
      ).toMatch(/Copied/)
    })
  })

  it('uses the right headline for each kind', () => {
    const { rerender } = render(
      <PostPublishPanel
        kind="playlist-group"
        feedUrl="https://feed.example/api/v1/playlist-groups/x"
        onPublishAnother={() => undefined}
        onViewPublished={() => undefined}
      />,
    )
    expect(screen.getByText('Playlist group published')).toBeTruthy()
    rerender(
      <PostPublishPanel
        kind="channel"
        feedUrl="https://feed.example/api/v1/channels/x"
        onPublishAnother={() => undefined}
        onViewPublished={() => undefined}
      />,
    )
    expect(screen.getByText('Channel published')).toBeTruthy()
  })
})
