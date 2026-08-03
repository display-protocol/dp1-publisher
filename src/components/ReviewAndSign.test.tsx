import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ReviewAndSign from './ReviewAndSign'
import * as apiModule from '@/lib/api'
import * as signingModule from '@/lib/signing'
import { ethereumAddressToDIDPKH } from '@/lib/signing'

const TEST_WALLET = '0x000000000000000000000000000000000000aBcD'
const TEST_WALLET_DID = ethereumAddressToDIDPKH(TEST_WALLET)
const OTHER_WALLET_DID = ethereumAddressToDIDPKH(
  '0x1111111111111111111111111111111111111111'
)

vi.mock('wagmi', () => {
  const address = '0x000000000000000000000000000000000000aBcD'
  return {
    useAccount: () => ({ isConnected: true, address }),
    useWalletClient: () => ({ data: { account: { address } } }),
  }
})

vi.mock('@/context/Dp1ExtensionsContext', () => ({
  useDp1Extensions: () => ({ extensionsEnabled: true, extensionsLoading: false }),
}))

const toastMock = vi.fn()
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
  // Toaster reads the hook module too; give it an inert list.
  toast: vi.fn(),
}))
vi.mock('@/components/ui/toaster', () => ({
  Toaster: () => null,
}))

// The wallet widget pulls in useDisconnect/useConnect — irrelevant here.
vi.mock('./WalletConnect', () => ({
  default: () => null,
}))

vi.mock('@/lib/signing', async () => {
  const actual = await vi.importActual<typeof import('@/lib/signing')>(
    '@/lib/signing'
  )
  return {
    ...actual,
    signDocument: vi.fn(async (_raw, _wc, role: 'curator' | 'publisher') => ({
      alg: 'eip191',
      kid: actual.ethereumAddressToDIDPKH(
        '0x000000000000000000000000000000000000aBcD'
      ),
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
    getPlaylist: vi.fn(),
    getChannel: vi.fn(),
    publishPlaylist: vi.fn(),
    publishChannel: vi.fn(),
    patchPlaylist: vi.fn(),
    patchChannel: vi.fn(),
  }
})

const mockedApi = apiModule as typeof apiModule & {
  getPlaylist: ReturnType<typeof vi.fn>
  getChannel: ReturnType<typeof vi.fn>
  publishPlaylist: ReturnType<typeof vi.fn>
  publishChannel: ReturnType<typeof vi.fn>
  patchPlaylist: ReturnType<typeof vi.fn>
}
const mockedSigning = signingModule as typeof signingModule & {
  signDocument: ReturnType<typeof vi.fn>
}

const PLAYLIST_ID = '385f79b6-a45f-4c1c-8080-e93a192adccc'

const pastedPlaylist = {
  dpVersion: '1.1.0',
  id: PLAYLIST_ID,
  title: 'Pasted Playlist',
  items: [{ source: 'https://example.com/art1.png' }],
}

function pasteJson(doc: unknown) {
  fireEvent.change(screen.getByPlaceholderText(/paste DP-1 JSON/i), {
    target: { value: JSON.stringify(doc) },
  })
}

// The editor is debounced (400ms) before parse/preflight run, so every
// assertion below goes through waitFor.
describe('ReviewAndSign', () => {
  beforeEach(() => {
    localStorage.clear()
    toastMock.mockClear()
    mockedSigning.signDocument.mockClear()
    for (const fn of [
      mockedApi.getPlaylist,
      mockedApi.getChannel,
      mockedApi.publishPlaylist,
      mockedApi.publishChannel,
      mockedApi.patchPlaylist,
    ]) {
      fn.mockReset()
    }
  })

  it('shows a parse error for invalid JSON and never hits the feed', async () => {
    render(<ReviewAndSign />)
    fireEvent.change(screen.getByPlaceholderText(/paste DP-1 JSON/i), {
      target: { value: 'not json' },
    })
    await waitFor(() => {
      expect(screen.getByText(/Not valid JSON/i)).toBeInTheDocument()
    })
    expect(mockedApi.getPlaylist).not.toHaveBeenCalled()
  })

  it('creates: summary + attestation render, sign POSTs with a curator signature', async () => {
    mockedApi.getPlaylist.mockRejectedValue(new apiModule.FeedAPIError('nf', 404))
    mockedApi.publishPlaylist.mockImplementation(async (p) => ({
      ...(p as Record<string, unknown>),
      slug: 'pasted-playlist',
    }))

    render(<ReviewAndSign />)
    pasteJson(pastedPlaylist)

    // Plain-language attestation from the prepared (post-pipeline) document.
    await waitFor(() => {
      expect(screen.getByText(/What you are signing/i)).toBeInTheDocument()
      expect(screen.getByText(/1 artwork \/ item/i)).toBeInTheDocument()
      expect(screen.getByText(/role: curator/i)).toBeInTheDocument()
    })

    const signButton = await screen.findByRole('button', { name: /Sign & publish/i })
    fireEvent.click(signButton)

    await waitFor(() => {
      expect(mockedApi.publishPlaylist).toHaveBeenCalledTimes(1)
    })
    expect(mockedSigning.signDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'curator'
    )
    const body = mockedApi.publishPlaylist.mock.calls[0][0] as {
      signatures: Array<{ role: string; kid: string }>
    }
    expect(body.signatures).toHaveLength(1)
    expect(body.signatures[0].role).toBe('curator')
    expect(mockedApi.patchPlaylist).not.toHaveBeenCalled()
    // Post-publish panel with the feed URL.
    expect(await screen.findByText(/Playlist published/i)).toBeInTheDocument()
  })

  it('blocks signing when the feed copy was signed by a different wallet', async () => {
    mockedApi.getPlaylist.mockResolvedValue({
      ...pastedPlaylist,
      signatures: [
        {
          alg: 'eip191',
          kid: OTHER_WALLET_DID,
          ts: '2026-01-01T00:00:00Z',
          payload_hash: 'sha256:x',
          role: 'curator',
          sig: 's',
        },
      ],
    })

    render(<ReviewAndSign />)
    pasteJson(pastedPlaylist)

    await waitFor(() => {
      expect(screen.getByText(/published by a different wallet/i)).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /Sign & publish/i })).toBeNull()
    expect(mockedSigning.signDocument).not.toHaveBeenCalled()
    expect(mockedApi.publishPlaylist).not.toHaveBeenCalled()
    expect(mockedApi.patchPlaylist).not.toHaveBeenCalled()
  })

  it('updates: summary reflects the MERGED document, and sign PATCHes', async () => {
    // Feed copy owned by this wallet, carrying a dynamicQuery the paste omits.
    // The merge resurrects it — the review pane must disclose it (issue #10:
    // the summary describes what is signed, not what was pasted).
    mockedApi.getPlaylist.mockResolvedValue({
      ...pastedPlaylist,
      title: 'Old title',
      dynamicQuery: {
        profile: 'https-json-v1',
        endpoint: 'https://api.example/items',
        responseMapping: { itemsPath: 'data', itemSchema: 'dp1/1.1' },
      },
      signatures: [
        {
          alg: 'eip191',
          kid: TEST_WALLET_DID,
          ts: '2026-01-01T00:00:00Z',
          payload_hash: 'sha256:x',
          role: 'curator',
          sig: 's',
        },
      ],
    })
    mockedApi.patchPlaylist.mockImplementation(async (_id, body) => ({
      ...(body as Record<string, unknown>),
      id: PLAYLIST_ID,
      slug: 'pasted-playlist',
    }))

    render(<ReviewAndSign />)
    pasteJson(pastedPlaylist)

    await waitFor(() => {
      // Resurrected dynamicQuery is disclosed in the facts…
      expect(screen.getByText(/loaded live/i)).toBeInTheDocument()
      // …and the pane says this is a merged update, not a fresh publish.
      expect(screen.getByText(/merged result/i)).toBeInTheDocument()
      expect(screen.getByText(/replace/i, { selector: 'strong' })).toBeInTheDocument()
    })

    fireEvent.click(
      await screen.findByRole('button', { name: /Sign & replace on feed/i })
    )
    await waitFor(() => {
      expect(mockedApi.patchPlaylist).toHaveBeenCalledTimes(1)
    })
    expect(mockedApi.patchPlaylist.mock.calls[0][0]).toBe(PLAYLIST_ID)
    expect(mockedApi.publishPlaylist).not.toHaveBeenCalled()
  })

  it('signs channels with the publisher role and publishes via the channel endpoint', async () => {
    mockedApi.getChannel.mockRejectedValue(new apiModule.FeedAPIError('nf', 404))
    mockedApi.publishChannel.mockImplementation(async (c) => ({
      ...(c as Record<string, unknown>),
      slug: 'test-channel',
    }))

    render(<ReviewAndSign />)
    // Publisher carries a name: the pipeline's validateChannelFields requires
    // one (the wallet injection only supplies the key), and real ff-cli
    // output declares the publishing entity.
    pasteJson({
      version: '1.1.0',
      title: 'Test Channel',
      publisher: { name: 'Test Gallery', key: OTHER_WALLET_DID },
      playlists: ['https://feed.example/api/v1/playlists/p1'],
    })

    await waitFor(() => {
      expect(screen.getByText(/role: publisher/i)).toBeInTheDocument()
      // Non-transitive coverage is the load-bearing disclosure for channels.
      expect(screen.getByText(/without your re-approval/i)).toBeInTheDocument()
    })

    fireEvent.click(await screen.findByRole('button', { name: /Sign & publish/i }))
    await waitFor(() => {
      expect(mockedApi.publishChannel).toHaveBeenCalledTimes(1)
    })
    expect(mockedSigning.signDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'publisher'
    )
  })

  // The page's whole promise is that the signature covers what was read. Both
  // stages upstream of `prepared` are asynchronous (400ms debounce, then a feed
  // GET), so an edit landing inside either window used to leave a live Sign
  // button wired to the previous document's bytes.
  it('withdraws the sign button while the editor is ahead of the prepared bytes', async () => {
    mockedApi.getPlaylist.mockRejectedValue(new apiModule.FeedAPIError('nf', 404))

    render(<ReviewAndSign />)
    pasteJson(pastedPlaylist)
    await screen.findByRole('button', { name: /Sign & publish/i })

    pasteJson({ ...pastedPlaylist, title: 'Edited Playlist' })

    // Asserted synchronously and without waitFor on purpose: the unsafe window
    // is the 400ms before the debounce fires, and any wait would let the page
    // settle into a legitimately signable state and hide the regression.
    expect(screen.getByText(/Reading your edits/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Sign & publish/i })).toBeNull()
    expect(mockedSigning.signDocument).not.toHaveBeenCalled()
    expect(mockedApi.publishPlaylist).not.toHaveBeenCalled()
  })

  it('carries the typed attribution name into the injected curator', async () => {
    mockedApi.getPlaylist.mockRejectedValue(new apiModule.FeedAPIError('nf', 404))
    mockedApi.publishPlaylist.mockImplementation(async (p) => ({
      ...(p as Record<string, unknown>),
      slug: 'pasted-playlist',
    }))

    render(<ReviewAndSign />)
    pasteJson(pastedPlaylist)
    fireEvent.change(screen.getByLabelText(/Attribution name/i), {
      target: { value: 'Test Curator' },
    })

    fireEvent.click(await screen.findByRole('button', { name: /Sign & publish/i }))
    await waitFor(() => {
      expect(mockedApi.publishPlaylist).toHaveBeenCalledTimes(1)
    })
    const body = mockedApi.publishPlaylist.mock.calls[0][0] as {
      curators: Array<{ name: string; key: string }>
    }
    expect(body.curators).toHaveLength(1)
    expect(body.curators[0].name).toBe('Test Curator')
    expect(body.curators[0].key).toBe(TEST_WALLET_DID)
  })

  it('never overwrites a curator name the document already declares', async () => {
    mockedApi.getPlaylist.mockRejectedValue(new apiModule.FeedAPIError('nf', 404))
    mockedApi.publishPlaylist.mockImplementation(async (p) => p as Record<string, unknown>)

    render(<ReviewAndSign />)
    pasteJson({
      ...pastedPlaylist,
      curators: [{ name: 'Declared Name', key: TEST_WALLET_DID }],
    })
    fireEvent.change(screen.getByLabelText(/Attribution name/i), {
      target: { value: 'Typed Name' },
    })

    fireEvent.click(await screen.findByRole('button', { name: /Sign & publish/i }))
    await waitFor(() => {
      expect(mockedApi.publishPlaylist).toHaveBeenCalledTimes(1)
    })
    const body = mockedApi.publishPlaylist.mock.calls[0][0] as {
      curators: Array<{ name: string }>
    }
    expect(body.curators[0].name).toBe('Declared Name')
  })

  it('withdraws the sign button while the attribution name is ahead of the prepared bytes', async () => {
    mockedApi.getPlaylist.mockRejectedValue(new apiModule.FeedAPIError('nf', 404))

    render(<ReviewAndSign />)
    pasteJson(pastedPlaylist)
    await screen.findByRole('button', { name: /Sign & publish/i })

    fireEvent.change(screen.getByLabelText(/Attribution name/i), {
      target: { value: 'Late Edit' },
    })

    // Same synchronous assertion rationale as the editor-text variant: the
    // unsafe window is the 400ms before the debounce fires.
    expect(screen.queryByRole('button', { name: /Sign & publish/i })).toBeNull()
    expect(mockedSigning.signDocument).not.toHaveBeenCalled()
  })

  it('signs the document in the editor, not the one it replaced', async () => {
    mockedApi.getPlaylist.mockRejectedValue(new apiModule.FeedAPIError('nf', 404))
    mockedApi.publishPlaylist.mockImplementation(async (p) => ({
      ...(p as Record<string, unknown>),
      slug: 'edited-playlist',
    }))

    render(<ReviewAndSign />)
    pasteJson(pastedPlaylist)
    await screen.findByRole('button', { name: /Sign & publish/i })

    pasteJson({ ...pastedPlaylist, title: 'Edited Playlist' })

    fireEvent.click(await screen.findByRole('button', { name: /Sign & publish/i }))
    await waitFor(() => {
      expect(mockedApi.publishPlaylist).toHaveBeenCalledTimes(1)
    })
    const body = mockedApi.publishPlaylist.mock.calls[0][0] as { title: string }
    expect(body.title).toBe('Edited Playlist')
  })
})

describe('ReviewAndSign — attribution recall', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('prefills the attribution name from the last published value', () => {
    localStorage.setItem('dp1-publisher.attribution-name', 'Sean Moss-Pultz')
    render(<ReviewAndSign />)
    expect(screen.getByLabelText(/attribution name/i)).toHaveValue('Sean Moss-Pultz')
  })

  it('starts empty when nothing was remembered', () => {
    render(<ReviewAndSign />)
    expect(screen.getByLabelText(/attribution name/i)).toHaveValue('')
  })
})
