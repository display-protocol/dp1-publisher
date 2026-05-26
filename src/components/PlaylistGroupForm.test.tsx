import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PlaylistGroupForm from './PlaylistGroupForm'
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

const signKid = ethereumAddressToDIDPKH(
  '0x000000000000000000000000000000000000aBcD',
)

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
    publishPlaylistGroup: vi.fn(),
    getPlaylistGroup: vi.fn(),
    patchPlaylistGroup: vi.fn(),
  }
})

const mockedApi = apiModule as typeof apiModule & {
  publishPlaylistGroup: ReturnType<typeof vi.fn>
  getPlaylistGroup: ReturnType<typeof vi.fn>
  patchPlaylistGroup: ReturnType<typeof vi.fn>
}

function fillFormAndPublish(title: string, playlistUrl: string) {
  fireEvent.change(screen.getByLabelText(/Title \*/i), {
    target: { value: title },
  })
  fireEvent.change(
    screen.getByPlaceholderText(/One playlist URL per line/i),
    { target: { value: playlistUrl } },
  )
  fireEvent.click(screen.getByRole('button', { name: /Check URLs/i }))
  fireEvent.click(screen.getByRole('button', { name: /Sign & publish/i }))
}

describe('PlaylistGroupForm — publish flow', () => {
  beforeEach(() => {
    localStorage.clear()
    toastMock.mockClear()
    mockedApi.publishPlaylistGroup.mockReset()
    mockedApi.getPlaylistGroup.mockReset()
    mockedApi.patchPlaylistGroup.mockReset()
  })

  it('regenerates id after a successful create, so "Publish another" POSTs a fresh group', async () => {
    mockedApi.getPlaylistGroup.mockRejectedValue(
      new apiModule.FeedAPIError('not found', 404),
    )
    mockedApi.publishPlaylistGroup.mockImplementation(async (g) => ({
      ...(g as Record<string, unknown>),
      slug: 'first-slug',
    }))

    render(<PlaylistGroupForm />)
    fillFormAndPublish('First group', 'https://feed.example/api/v1/playlists/p1')

    await waitFor(() => {
      expect(mockedApi.publishPlaylistGroup).toHaveBeenCalledTimes(1)
    })
    const firstId = (
      mockedApi.publishPlaylistGroup.mock.calls[0][0] as { id: string }
    ).id

    const publishAnother = await screen.findByRole('button', {
      name: /Publish another/i,
    })
    fireEvent.click(publishAnother)

    fillFormAndPublish('Second group', 'https://feed.example/api/v1/playlists/p2')

    await waitFor(() => {
      expect(mockedApi.publishPlaylistGroup).toHaveBeenCalledTimes(2)
    })
    const secondId = (
      mockedApi.publishPlaylistGroup.mock.calls[1][0] as { id: string }
    ).id
    expect(secondId).not.toBe(firstId)
    expect(mockedApi.patchPlaylistGroup).not.toHaveBeenCalled()
  })

  it('refuses to sign or PATCH when preflight returns a group signed by a different wallet', async () => {
    // PlaylistGroup uses singular `curator` (string), but the ownership gate
    // authorizes by prior signature, so this test mirrors the playlist/channel
    // cases: prior signature is from another wallet → gate aborts.
    mockedApi.getPlaylistGroup.mockResolvedValue({
      id: 'preexisting-id',
      slug: 'preexisting',
      title: 'Preexisting',
      created: '2025-01-01T00:00:00Z',
      playlists: ['https://feed.example/api/v1/playlists/p1'],
      curator: 'did:pkh:eip155:1:0xDeAd000000000000000000000000000000000001',
      signatures: [
        {
          alg: 'eip191',
          kid: 'did:pkh:eip155:1:0xDeAd000000000000000000000000000000000001',
          ts: '2025-01-01T00:00:00Z',
          payload_hash: 'sha256:other',
          role: 'curator',
          sig: 'other-sig',
        },
      ],
    })

    const signingModule = await import('@/lib/signing')
    const signSpy = signingModule.signDocument as unknown as ReturnType<typeof vi.fn>
    signSpy.mockClear()

    render(<PlaylistGroupForm />)
    fillFormAndPublish('Whatever', 'https://feed.example/api/v1/playlists/p1')

    await waitFor(() => {
      const updateFailures = toastMock.mock.calls.filter(
        ([arg]) => arg?.title === 'Update failed',
      )
      expect(updateFailures.length).toBeGreaterThan(0)
    })

    expect(signSpy).not.toHaveBeenCalled()
    expect(mockedApi.patchPlaylistGroup).not.toHaveBeenCalled()
    expect(mockedApi.publishPlaylistGroup).not.toHaveBeenCalled()
  })

  it('shows the overwrite-specific error when an auto-overwrite PATCH is rejected (wrong wallet)', async () => {
    // Existing group was signed by THIS wallet (so ownership gate passes),
    // and the server then rejects the PATCH with 401.
    mockedApi.getPlaylistGroup.mockResolvedValue({
      id: 'preexisting-id',
      slug: 'preexisting',
      title: 'Preexisting',
      created: '2025-01-01T00:00:00Z',
      playlists: ['https://feed.example/api/v1/playlists/p1'],
      curator: TEST_WALLET_DID,
      signatures: [
        {
          alg: 'eip191',
          kid: TEST_WALLET_DID,
          ts: '2025-01-01T00:00:00Z',
          payload_hash: 'sha256:prior',
          role: 'curator',
          sig: 'prior-sig',
        },
      ],
    })
    mockedApi.patchPlaylistGroup.mockRejectedValue(
      new apiModule.FeedAPIError('signature rejected', 401, 'unauthorized'),
    )

    render(<PlaylistGroupForm />)
    fillFormAndPublish('Whatever', 'https://feed.example/api/v1/playlists/p1')

    await waitFor(() => {
      expect(mockedApi.patchPlaylistGroup).toHaveBeenCalledTimes(1)
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
