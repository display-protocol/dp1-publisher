import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import Dashboard from './Dashboard'

vi.mock('wagmi', () => ({
  useAccount: () => ({
    isConnected: true,
    address: '0x000000000000000000000000000000000000aBcD',
  }),
}))

vi.mock('@/context/Dp1ExtensionsContext', () => ({
  useDp1Extensions: () => ({
    extensionsEnabled: true,
    extensionsLoading: false,
  }),
}))

// Stub the heavy publish forms — Dashboard's state machine is what we're
// testing, not the forms themselves (those have their own tests). Each stub
// exposes the props it was rendered with so the test can assert on them
// (initialPlaylistsText is the load-bearing one for this regression) and
// emits a button that fires onUseInNewChannel so the test can drive the
// "Use in a new channel" handoff without rendering the real PostPublishPanel.
vi.mock('./PlaylistForm', () => ({
  __esModule: true,
  default: (props: {
    onUseInNewChannel?: (url: string) => void
  }) => (
    <button
      type="button"
      data-testid="trigger-use-in-new-channel"
      onClick={() => props.onUseInNewChannel?.('https://feed.example/api/v1/playlists/just-published')}
    >
      simulate Use in new channel
    </button>
  ),
}))

vi.mock('./PlaylistGroupForm', () => ({
  __esModule: true,
  default: () => <div data-testid="playlist-group-form" />,
}))

vi.mock('./ChannelForm', () => ({
  __esModule: true,
  default: (props: { initialPlaylistsText?: string }) => (
    <div
      data-testid="channel-form"
      data-initial-playlists-text={props.initialPlaylistsText ?? ''}
    />
  ),
}))

vi.mock('./PublishedView', () => ({
  __esModule: true,
  default: () => <div data-testid="published-view" />,
}))

vi.mock('./WalletConnect', () => ({
  __esModule: true,
  default: () => <div data-testid="wallet-connect" />,
}))

vi.mock('@/components/ui/toaster', () => ({
  Toaster: () => null,
}))

describe('Dashboard — pendingChannelPlaylistsText lifecycle', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('clears the new-channel pre-fill URL when navigating to Published and back', async () => {
    render(<Dashboard />)

    // Step 1: trigger "Use in new channel" from the playlist surface.
    fireEvent.click(screen.getByTestId('trigger-use-in-new-channel'))

    // Channel form mounts with the pre-fill URL — Dashboard handed off the
    // just-published playlist URL into the channel composer.
    await waitFor(() => {
      const channelForm = screen.getByTestId('channel-form')
      expect(channelForm.getAttribute('data-initial-playlists-text')).toBe(
        'https://feed.example/api/v1/playlists/just-published',
      )
    })

    // Step 2: navigate to Published (handleViewPublished → clearEditState).
    fireEvent.click(screen.getByRole('tab', { name: /Published/i }))
    await waitFor(() => {
      expect(screen.getByTestId('published-view')).toBeTruthy()
    })

    // Step 3: navigate back to Publish (Publish tab onClick → clearEditState).
    fireEvent.click(screen.getByRole('tab', { name: /Publish$/i }))

    // Channel tab was the active publishTab from step 1, so ChannelForm
    // remounts. The regression: it must remount WITHOUT the stale URL.
    await waitFor(() => {
      const channelForm = screen.getByTestId('channel-form')
      expect(channelForm.getAttribute('data-initial-playlists-text')).toBe('')
    })
  })
})
