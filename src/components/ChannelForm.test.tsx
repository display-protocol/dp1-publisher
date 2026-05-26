import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ChannelForm from './ChannelForm'
import * as apiModule from '@/lib/api'

vi.mock('wagmi', () => {
  const address = '0x000000000000000000000000000000000000aBcD'
  return {
    useAccount: () => ({ address }),
    useWalletClient: () => ({ data: { account: { address } } }),
  }
})

const toastMock = vi.fn()
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}))

vi.mock('@/lib/signing', async () => {
  const actual = await vi.importActual<typeof import('@/lib/signing')>(
    '@/lib/signing',
  )
  return {
    ...actual,
    signDocument: vi.fn(async (_raw, _wc, role: 'curator' | 'publisher') => ({
      alg: 'eip191',
      kid: 'did:pkh:eip155:1:0x000000000000000000000000000000000000aBcD',
      ts: new Date().toISOString(),
      payload_hash: 'sha256:test',
      role,
      sig: 'test-signature',
    })),
  }
})

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof apiModule>('@/lib/api')
  return {
    ...actual,
    publishChannel: vi.fn(),
    getChannel: vi.fn(),
    patchChannel: vi.fn(),
  }
})

const mockedApi = apiModule as typeof apiModule & {
  publishChannel: ReturnType<typeof vi.fn>
  getChannel: ReturnType<typeof vi.fn>
  patchChannel: ReturnType<typeof vi.fn>
}

function fillFormAndPublish(title: string, playlistUrl: string) {
  fireEvent.change(screen.getByLabelText(/Title \*/i), {
    target: { value: title },
  })
  // Channel form requires a publisher name; pick the input by its id directly
  // since /Name \*/ would otherwise collide with curator name fields.
  const publisherNameInput = document.querySelector(
    '#publisher-name',
  ) as HTMLInputElement
  fireEvent.change(publisherNameInput, {
    target: { value: 'Test Publisher' },
  })
  fireEvent.change(screen.getByLabelText(/Playlist URIs/i), {
    target: { value: playlistUrl },
  })
  fireEvent.click(screen.getByRole('button', { name: /Check URLs/i }))
  fireEvent.click(screen.getByRole('button', { name: /Sign & publish/i }))
}

describe('ChannelForm — publish flow', () => {
  beforeEach(() => {
    localStorage.clear()
    toastMock.mockClear()
    mockedApi.publishChannel.mockReset()
    mockedApi.getChannel.mockReset()
    mockedApi.patchChannel.mockReset()
  })

  it('regenerates id after a successful create, so "Publish another" POSTs a fresh channel', async () => {
    mockedApi.getChannel.mockRejectedValue(new apiModule.FeedAPIError('not found', 404))
    mockedApi.publishChannel.mockImplementation(async (c) => ({
      ...(c as Record<string, unknown>),
      slug: 'first-slug',
    }))

    render(<ChannelForm />)
    fillFormAndPublish('First channel', 'https://feed.example/api/v1/playlists/p1')

    await waitFor(() => {
      expect(mockedApi.publishChannel).toHaveBeenCalledTimes(1)
    })
    const firstId = (mockedApi.publishChannel.mock.calls[0][0] as { id: string }).id

    const publishAnother = await screen.findByRole('button', {
      name: /Publish another/i,
    })
    fireEvent.click(publishAnother)

    fillFormAndPublish('Second channel', 'https://feed.example/api/v1/playlists/p2')

    await waitFor(() => {
      expect(mockedApi.publishChannel).toHaveBeenCalledTimes(2)
    })
    const secondId = (mockedApi.publishChannel.mock.calls[1][0] as { id: string }).id
    expect(secondId).not.toBe(firstId)
    expect(mockedApi.patchChannel).not.toHaveBeenCalled()
  })

  it('shows the overwrite-specific error when an auto-overwrite PATCH is rejected (wrong wallet)', async () => {
    mockedApi.getChannel.mockResolvedValue({
      dpVersion: '1.1.0',
      id: 'preexisting-id',
      slug: 'preexisting',
      title: 'Preexisting',
      created: '2025-01-01T00:00:00Z',
      playlists: ['https://feed.example/api/v1/playlists/p1'],
      publisher: {
        name: 'Other',
        key: 'did:pkh:eip155:1:0x000000000000000000000000000000000000aBcD',
      },
    })
    mockedApi.patchChannel.mockRejectedValue(
      new apiModule.FeedAPIError('signature rejected', 401, 'unauthorized'),
    )

    render(<ChannelForm />)
    fillFormAndPublish('Whatever', 'https://feed.example/api/v1/playlists/p1')

    await waitFor(() => {
      expect(mockedApi.patchChannel).toHaveBeenCalledTimes(1)
    })

    await waitFor(() => {
      const updateFailureCalls = toastMock.mock.calls.filter(
        ([arg]) => arg?.title === 'Update failed',
      )
      expect(updateFailureCalls.length).toBeGreaterThan(0)
      const desc = updateFailureCalls[updateFailureCalls.length - 1][0]
        .description as string
      expect(desc).toMatch(/different wallet/i)
    })
  })
})
