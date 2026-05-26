import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ChannelForm from './ChannelForm'
import * as apiModule from '@/lib/api'
import { ethereumAddressToDIDPKH } from '@/lib/signing'

const TEST_WALLET = '0x000000000000000000000000000000000000aBcD'
const TEST_WALLET_DID = ethereumAddressToDIDPKH(TEST_WALLET)

vi.mock('wagmi', () => {
  const address = '0x000000000000000000000000000000000000aBcD'
  return {
    useAccount: () => ({ address }),
    useWalletClient: () => ({ data: { account: { address } } }),
  }
})

const signKid = ethereumAddressToDIDPKH('0x000000000000000000000000000000000000aBcD')

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
      kid: signKid,
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

  it('refuses to sign or PATCH when preflight returns a channel signed by a different wallet', async () => {
    mockedApi.getChannel.mockResolvedValue({
      dpVersion: '1.1.0',
      id: 'preexisting-id',
      slug: 'preexisting',
      title: 'Preexisting',
      created: '2025-01-01T00:00:00Z',
      playlists: ['https://feed.example/api/v1/playlists/p1'],
      publisher: {
        name: 'Other',
        key: 'did:pkh:eip155:1:0xDeAd000000000000000000000000000000000001',
      },
      signatures: [
        {
          alg: 'eip191',
          kid: 'did:pkh:eip155:1:0xDeAd000000000000000000000000000000000001',
          ts: '2025-01-01T00:00:00Z',
          payload_hash: 'sha256:other',
          role: 'publisher',
          sig: 'other-sig',
        },
      ],
    })

    const signingModule = await import('@/lib/signing')
    const signSpy = signingModule.signDocument as unknown as ReturnType<typeof vi.fn>
    signSpy.mockClear()

    render(<ChannelForm />)
    fillFormAndPublish('Whatever', 'https://feed.example/api/v1/playlists/p1')

    await waitFor(() => {
      const updateFailures = toastMock.mock.calls.filter(
        ([arg]) => arg?.title === 'Update failed',
      )
      expect(updateFailures.length).toBeGreaterThan(0)
    })

    expect(signSpy).not.toHaveBeenCalled()
    expect(mockedApi.patchChannel).not.toHaveBeenCalled()
    expect(mockedApi.publishChannel).not.toHaveBeenCalled()
  })

  it('JSON-import "Use in a channel" prefill appends to multi-playlist arrays instead of collapsing them', async () => {
    const prefill = 'https://feed.example/api/v1/playlists/prefill'
    const a = 'https://feed.example/api/v1/playlists/A'
    const b = 'https://feed.example/api/v1/playlists/B'

    render(<ChannelForm initialPlaylistsText={prefill} />)

    // Switch to JSON tab. Radix Tabs activates on pointerdown/mousedown rather
    // than click in some browser modes; happy-dom needs the mousedown too.
    const jsonTab = screen.getByRole('tab', { name: /JSON/i })
    fireEvent.mouseDown(jsonTab)
    fireEvent.click(jsonTab)

    await waitFor(() => {
      const t = document.querySelector(
        'textarea[placeholder*="DP-1"]',
      ) as HTMLTextAreaElement | null
      expect(t).not.toBeNull()
    })
    const jsonTextarea = document.querySelector(
      'textarea[placeholder*="DP-1"]',
    ) as HTMLTextAreaElement

    // Drop a JSON channel that already references playlists A and B but NOT
    // the prefill. The fix must append prefill rather than collapse to it.
    const dropped = {
      dpVersion: '1.1.0',
      id: 'incoming-id',
      title: 'Imported channel',
      version: '1.0.0',
      playlists: [a, b],
      publisher: { name: 'Bob', key: TEST_WALLET_DID },
    }
    fireEvent.change(jsonTextarea, {
      target: { value: JSON.stringify(dropped, null, 2) },
    })

    await waitFor(() => {
      const updated = jsonTextarea.value
      expect(updated).toContain(a)
      expect(updated).toContain(b)
      expect(updated).toContain(prefill)
    })

    // And the toast must reflect the append-not-replace behavior.
    const appendToast = toastMock.mock.calls.find(
      ([arg]) => arg?.title === 'Playlist URL added',
    )
    expect(appendToast).toBeTruthy()
  })

  it('shows the overwrite-specific error when an auto-overwrite PATCH is rejected (wrong wallet)', async () => {
    // Existing channel was previously signed by THIS wallet as publisher (so
    // the ownership gate passes); server then rejects the PATCH with 401.
    mockedApi.getChannel.mockResolvedValue({
      dpVersion: '1.1.0',
      id: 'preexisting-id',
      slug: 'preexisting',
      title: 'Preexisting',
      created: '2025-01-01T00:00:00Z',
      playlists: ['https://feed.example/api/v1/playlists/p1'],
      publisher: {
        name: 'Other',
        key: TEST_WALLET_DID,
      },
      signatures: [
        {
          alg: 'eip191',
          kid: TEST_WALLET_DID,
          ts: '2025-01-01T00:00:00Z',
          payload_hash: 'sha256:prior',
          role: 'publisher',
          sig: 'prior-sig',
        },
      ],
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
