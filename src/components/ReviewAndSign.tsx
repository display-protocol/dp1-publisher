import { useEffect, useMemo, useRef, useState } from 'react'
import { useAccount, useWalletClient } from 'wagmi'
import { getAddress } from 'viem'
import { ArrowLeft, PenLine, ShieldAlert } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Toaster } from '@/components/ui/toaster'
import { useToast } from '@/hooks/use-toast'
import { useDp1Extensions } from '@/context/Dp1ExtensionsContext'
import JsonFileDropZone from './JsonFileDropZone'
import WalletConnect from './WalletConnect'
import PostPublishPanel, { type PostPublishMode } from './PostPublishPanel'
import {
  describeReviewDocument,
  parseReviewDocument,
  type ReviewedDp1Document,
} from '@/lib/reviewDocument'
import {
  prepareChannelForPublish,
  preparePlaylistForPublish,
  preparePlaylistGroupForPublish,
  type PrepareResult,
  type ToastInput,
} from '@/lib/preparePublish'
import { ethereumAddressToDIDPKH, signDocument } from '@/lib/signing'
import {
  isWalletAuthorizedToOverwrite,
  wrongWalletForOverwriteMessage,
} from '@/lib/overwriteAuth'
import {
  FeedAPIError,
  feedChannelResourceUrl,
  feedPlaylistGroupResourceUrl,
  feedPlaylistResourceUrl,
  friendlyPublishError,
  getChannel,
  getPlaylist,
  getPlaylistGroup,
  patchChannel,
  patchPlaylist,
  patchPlaylistGroup,
  publishChannel,
  publishPlaylist,
  publishPlaylistGroup,
} from '@/lib/api'
import {
  recordPublishedChannel,
  recordPublishedPlaylist,
  recordPublishedPlaylistGroup,
} from '@/lib/publishedStorage'
import type { Channel, Playlist, PlaylistGroup } from '@/types/dp1'

type PreparedState =
  | { status: 'idle' }
  | { status: 'preparing' }
  /** Signing must not proceed (wrong wallet for overwrite, validation failure). */
  | { status: 'blocked'; message: string }
  | {
      status: 'ready'
      /**
       * The post-pipeline document (merged with the feed base on updates,
       * extension-stripped, wallet identity ensured) — what the signature
       * actually covers. The review summary MUST render from this, not from
       * the paste: on updates, `merge*ForPatch` resurrects fields the paste
       * omits (dynamicQuery, curators, …), and a summary of the pasted text
       * would misstate what is being attested.
       */
      signed: ReviewedDp1Document
      signedBytes: Record<string, unknown>
      wireBody: Record<string, unknown>
      mode: PostPublishMode
      /** What the pipeline adjusted beyond the pasted document (identity injection etc.). */
      receipts: ToastInput[]
      /**
       * The exact editor text these bytes were derived from. The page promises
       * that you sign what you read, and everything upstream of this state is
       * asynchronous: the editor feeds a 400 ms debounce, and the prepare
       * effect then awaits a feed GET. Without an identity check at the sign
       * boundary, edits made inside either window leave `prepared` holding the
       * previous document while the editor shows the new one, and the click
       * signs what is no longer on screen. Compare this against the live
       * editor text rather than trusting timing.
       */
      sourceText: string
      /** The attribution name these bytes were derived from — same gate as `sourceText`. */
      sourceName: string
    }

interface PublishedDoc {
  kind: ReviewedDp1Document['kind']
  feedUrl: string
  title: string
  mode: PostPublishMode
  receipts: ToastInput[]
}

/**
 * Fetch the current feed version of the document, if any. 404 → undefined
 * (normal create). Other errors are swallowed like the forms' preflight —
 * the POST will surface whatever is actually wrong, so a transient feed blip
 * doesn't false-block the page.
 */
async function preflightExisting(
  reviewed: ReviewedDp1Document
): Promise<Playlist | Channel | PlaylistGroup | undefined> {
  const id = reviewed.document.id
  if (!id) return undefined
  try {
    if (reviewed.kind === 'playlist') return await getPlaylist(id)
    if (reviewed.kind === 'channel') return await getChannel(id)
    return await getPlaylistGroup(id)
  } catch (e) {
    if (e instanceof FeedAPIError && e.status === 404) return undefined
    return undefined
  }
}

type PreparedOk = {
  signed: ReviewedDp1Document
  signedBytes: Record<string, unknown>
  wireBody: Record<string, unknown>
  toasts: ToastInput[]
}

/**
 * Kind-dispatch into the shared publish pipeline. Returns the post-pipeline
 * document re-wrapped with its kind so callers get a typed
 * `ReviewedDp1Document` for summarizing/publishing without casts.
 */
function prepareReviewed(
  reviewed: ReviewedDp1Document,
  walletDID: string,
  base: Playlist | Channel | PlaylistGroup | undefined,
  extensionsEnabled: boolean,
  walletName: string
): PreparedOk | { validationErrors: string[] } {
  const ok = <T,>(
    r: PrepareResult<T>,
    wrap: (payload: T) => ReviewedDp1Document
  ): PreparedOk | { validationErrors: string[] } =>
    'validationErrors' in r
      ? r
      : {
          signed: wrap(r.signedPayload),
          signedBytes: r.signedBytes,
          wireBody: r.wireBody,
          toasts: r.toasts,
        }

  if (reviewed.kind === 'playlist') {
    return ok(
      preparePlaylistForPublish({
        rawDocument: reviewed.document,
        walletDID,
        base: base as Playlist | undefined,
        extensionsEnabled,
        walletName,
      }),
      (p) => ({ kind: 'playlist', document: p })
    )
  }
  if (reviewed.kind === 'channel') {
    return ok(
      prepareChannelForPublish({
        rawDocument: reviewed.document,
        walletDID,
        base: base as Channel | undefined,
        walletName,
      }),
      (c) => ({ kind: 'channel', document: c })
    )
  }
  return ok(
    preparePlaylistGroupForPublish({
      rawDocument: reviewed.document,
      walletDID,
      base: base as PlaylistGroup | undefined,
    }),
    (g) => ({ kind: 'playlist-group', document: g })
  )
}

const OVERWRITE_NOUN = {
  playlist: 'playlist',
  channel: 'channel',
  'playlist-group': 'playlist group',
} as const

/**
 * Review-and-sign page (`#/sign`): paste or drop an already-composed DP-1
 * document, see in plain language what a wallet signature over it means, then
 * sign and publish through the same `preparePublish` chokepoint the forms use.
 *
 * Prototype for the direction proposed in issue #10 — composition happens in
 * ff-cli / agents; the web surface's job is a trustworthy signing ceremony.
 * The forms remain untouched alongside this page.
 */
export default function ReviewAndSign() {
  const { isConnected, address } = useAccount()
  const { data: walletClient } = useWalletClient()
  const { extensionsEnabled, extensionsLoading } = useDp1Extensions()
  const { toast } = useToast()

  const [jsonText, setJsonText] = useState('')
  const [signerName, setSignerName] = useState('')
  const [prepared, setPrepared] = useState<PreparedState>({ status: 'idle' })
  const [isPublishing, setIsPublishing] = useState(false)
  const [publishedDoc, setPublishedDoc] = useState<PublishedDoc | null>(null)
  /** Stale-async guard: only the latest preflight/prepare run may set state. */
  const prepareTokenRef = useRef(0)

  // Debounced copy of the editor text. Parsing regenerates fallback uuids and
  // the prepare effect hits the feed with a GET — neither should run per
  // keystroke, only when the user pauses.
  const [settledJsonText, setSettledJsonText] = useState('')
  useEffect(() => {
    const t = window.setTimeout(() => setSettledJsonText(jsonText), 400)
    return () => window.clearTimeout(t)
  }, [jsonText])

  // The attribution name lands inside the signed bytes, so it rides the same
  // debounce → prepare → staleness gate as the document text.
  const [settledSignerName, setSettledSignerName] = useState('')
  useEffect(() => {
    const t = window.setTimeout(() => setSettledSignerName(signerName), 400)
    return () => window.clearTimeout(t)
  }, [signerName])

  const parseResult = useMemo(() => {
    const trimmed = settledJsonText.trim()
    if (!trimmed) return null
    return parseReviewDocument(trimmed, { extensionsEnabled })
  }, [settledJsonText, extensionsEnabled])

  const reviewed = parseResult && 'doc' in parseResult ? parseResult.doc : null

  // True while the editor holds text the pipeline has not caught up with. Both
  // `reviewed` and `prepared` are derived from `settledJsonText`, so during
  // this window every rendered summary describes the *previous* document.
  const settling = jsonText !== settledJsonText || signerName !== settledSignerName

  // Signing is allowed only against the text on screen. See `sourceText`.
  const signable =
    prepared.status === 'ready' &&
    prepared.sourceText === jsonText &&
    prepared.sourceName === signerName

  // Once the pipeline has run, summarize what will actually be signed (merged
  // base + injected identity); before that, preview the parsed paste. While
  // settling, show nothing rather than a summary of superseded text.
  const summarySource = settling ? null : signable ? prepared.signed : reviewed
  const summary = useMemo(
    () => (summarySource ? describeReviewDocument(summarySource) : null),
    [summarySource]
  )

  // Preflight + prepare as soon as we have both a valid document and a wallet.
  // This is what makes the page a *review* surface: identity injection and
  // create-vs-overwrite mode are computed and shown before the user is asked
  // to sign, instead of flashing past in toasts afterwards.
  useEffect(() => {
    const token = ++prepareTokenRef.current
    if (!reviewed || !address) {
      setPrepared({ status: 'idle' })
      return
    }
    setPrepared({ status: 'preparing' })
    ;(async () => {
      const walletDID = ethereumAddressToDIDPKH(getAddress(address))
      const base = await preflightExisting(reviewed)
      if (token !== prepareTokenRef.current) return
      if (base) {
        const role = reviewed.kind === 'channel' ? 'publisher' : 'curator'
        if (!isWalletAuthorizedToOverwrite(base, role, walletDID)) {
          setPrepared({
            status: 'blocked',
            message: wrongWalletForOverwriteMessage(OVERWRITE_NOUN[reviewed.kind]),
          })
          return
        }
      }
      const prep = prepareReviewed(reviewed, walletDID, base, extensionsEnabled, settledSignerName)
      if (token !== prepareTokenRef.current) return
      if ('validationErrors' in prep) {
        setPrepared({ status: 'blocked', message: prep.validationErrors[0] })
        return
      }
      setPrepared({
        status: 'ready',
        signed: prep.signed,
        signedBytes: prep.signedBytes,
        wireBody: prep.wireBody,
        mode: base ? 'update' : 'create',
        receipts: prep.toasts,
        // `reviewed` is parsed from `settledJsonText`, so that is the text
        // these bytes attest to.
        sourceText: settledJsonText,
        sourceName: settledSignerName,
      })
    })()
  }, [reviewed, settledJsonText, settledSignerName, address, extensionsEnabled])

  const handleSignAndPublish = async () => {
    if (!walletClient || !address || prepared.status !== 'ready') return
    // Refuse to sign bytes the editor has already moved past. The button is
    // disabled in this state, so reaching here means the text changed between
    // render and click; failing closed is the only safe answer on a page whose
    // promise is that the signature covers what was read.
    if (prepared.sourceText !== jsonText || prepared.sourceName !== signerName) return
    // Everything below reads from `prepared` only — the signed pair
    // (bytes ↔ document identity) stays atomic even if the editor text
    // changes mid-flight.
    const signed = prepared.signed
    setIsPublishing(true)
    try {
      const role = signed.kind === 'channel' ? 'publisher' : 'curator'
      const signature = await signDocument(prepared.signedBytes, walletClient, role)
      const body = { ...prepared.wireBody, signatures: [signature] }
      const isUpdate = prepared.mode === 'update'
      const id = signed.document.id ?? ''

      let feedUrl: string
      let title: string
      if (signed.kind === 'playlist') {
        const result = isUpdate
          ? await patchPlaylist(id, body)
          : await publishPlaylist(body as unknown as Playlist)
        recordPublishedPlaylist(address, result)
        feedUrl = feedPlaylistResourceUrl(result.slug?.trim() || result.id || '')
        title = result.title?.trim() || 'Untitled playlist'
      } else if (signed.kind === 'channel') {
        const result = isUpdate
          ? await patchChannel(id, body)
          : await publishChannel(body as unknown as Channel)
        recordPublishedChannel(address, result)
        feedUrl = feedChannelResourceUrl(result.slug?.trim() || result.id || '')
        title = result.title?.trim() || 'Untitled channel'
      } else {
        const result = isUpdate
          ? await patchPlaylistGroup(id, body)
          : await publishPlaylistGroup(body)
        recordPublishedPlaylistGroup(address, result)
        feedUrl = feedPlaylistGroupResourceUrl(result.slug?.trim() || result.id || '')
        title = result.title?.trim() || 'Untitled playlist group'
      }

      setPublishedDoc({
        kind: signed.kind,
        feedUrl,
        title,
        mode: prepared.mode,
        receipts: prepared.receipts,
      })
    } catch (error) {
      console.error('Sign-and-publish failed:', error)
      toast({
        title: prepared.mode === 'update' ? 'Update failed' : 'Publish failed',
        description: friendlyPublishError(error, signed.kind, prepared.mode),
        variant: 'destructive',
      })
    } finally {
      setIsPublishing(false)
    }
  }

  const resetForAnother = () => {
    setJsonText('')
    setSettledJsonText('')
    setPublishedDoc(null)
    setPrepared({ status: 'idle' })
  }

  return (
    <>
      <div className="relative mx-auto max-w-3xl px-5 py-14 sm:px-8 sm:py-20">
        <header className="mb-10 flex flex-col gap-8 sm:mb-12 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-4">
            <p className="section-label">Display Protocol</p>
            <div className="space-y-3">
              <h1 className="font-display text-[2rem] font-normal leading-[1.15] tracking-tight text-foreground sm:text-4xl">
                Review &amp; sign
              </h1>
              <p className="max-w-sm text-[15px] leading-relaxed text-muted-foreground">
                Paste a DP-1 document prepared by your tools, review what your
                signature will mean, then sign with your wallet and publish.
              </p>
              <a
                href="#/"
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                <ArrowLeft className="size-3.5" aria-hidden />
                Back to the composer dashboard
              </a>
              {extensionsLoading ? (
                <p className="text-xs text-muted-foreground">Checking feed extension settings…</p>
              ) : null}
            </div>
          </div>
          {isConnected ? (
            <div className="shrink-0 sm:pt-1">
              <WalletConnect />
            </div>
          ) : null}
        </header>

        {publishedDoc ? (
          <PostPublishPanel
            kind={publishedDoc.kind}
            mode={publishedDoc.mode}
            feedUrl={publishedDoc.feedUrl}
            title={publishedDoc.title}
            receipts={publishedDoc.receipts.map((r) => ({
              title: r.title,
              description: r.description,
            }))}
            onPublishAnother={resetForAnother}
            onViewPublished={() => {
              window.location.hash = '#/'
            }}
          />
        ) : (
          <div className="space-y-8">
            <Card className="border-border/50">
              <CardHeader className="space-y-2 pb-4">
                <CardTitle className="font-display text-xl font-normal tracking-tight">
                  1. Document
                </CardTitle>
                <CardDescription className="text-[15px]">
                  Drop or paste the playlist, playlist group, or channel JSON
                  your tools produced. Prior signatures are stripped — your
                  wallet signs fresh.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <JsonFileDropZone value={jsonText} onChange={setJsonText} rows={10} />
                <div className="mt-4 space-y-1.5">
                  <label
                    htmlFor="signer-attribution-name"
                    className="text-sm font-medium text-foreground"
                  >
                    Attribution name <span className="text-muted-foreground">(optional)</span>
                  </label>
                  <Input
                    id="signer-attribution-name"
                    value={signerName}
                    onChange={(e) => setSignerName(e.target.value)}
                    placeholder="Shown next to your wallet on the published document"
                    autoComplete="name"
                  />
                  <p className="text-xs text-muted-foreground">
                    Fills the empty name when your wallet is added as curator or
                    publisher. Names already declared in the document are kept.
                  </p>
                </div>
                {parseResult && 'error' in parseResult ? (
                  <p className="mt-3 flex items-start gap-2 text-sm text-destructive">
                    <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {parseResult.error}
                  </p>
                ) : null}
              </CardContent>
            </Card>

            {summary ? (
              <Card className="border-border/50">
                <CardHeader className="space-y-2 pb-4">
                  <p className="section-label">{summary.kindLabel}</p>
                  <CardTitle className="font-display text-xl font-normal tracking-tight">
                    2. What you are signing
                  </CardTitle>
                  <CardDescription className="text-[15px]">
                    “{summary.title}”
                  </CardDescription>
                  {prepared.status === 'ready' && prepared.mode === 'update' ? (
                    <CardDescription className="text-[13px]">
                      This summary shows the merged result: the version already
                      on the feed, updated with your pasted changes.
                    </CardDescription>
                  ) : null}
                </CardHeader>
                <CardContent className="space-y-6">
                  {summary.identity.length > 0 ? (
                    <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                      {summary.identity.map((line) => (
                        <p key={line} className="font-mono text-xs text-muted-foreground">
                          {line}
                        </p>
                      ))}
                    </div>
                  ) : null}

                  <ul className="list-disc space-y-1.5 pl-5 text-sm text-foreground">
                    {summary.facts.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>

                  <div className="space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Your signature covers
                    </p>
                    <ul className="list-disc space-y-1.5 pl-5 text-sm text-foreground">
                      {summary.covers.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      What can change afterwards
                    </p>
                    <ul className="list-disc space-y-1.5 pl-5 text-sm text-foreground">
                      {summary.canChangeAfter.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {/* `settling` keeps this card mounted through the debounce so the
                withdrawn Sign button reads as "not yet" rather than vanishing. */}
            {summary || settling ? (
              <Card className="border-border/50">
                <CardHeader className="space-y-2 pb-4">
                  <CardTitle className="font-display text-xl font-normal tracking-tight">
                    3. Sign &amp; publish
                  </CardTitle>
                  {!isConnected ? (
                    <CardDescription className="text-[15px]">
                      Connect an Ethereum mainnet wallet to continue. No API
                      keys — only your signature.
                    </CardDescription>
                  ) : null}
                </CardHeader>
                <CardContent className="space-y-5">
                  {!isConnected ? (
                    <div className="flex justify-center py-2">
                      <WalletConnect />
                    </div>
                  ) : settling ? (
                    <p className="text-sm text-muted-foreground">
                      Reading your edits…
                    </p>
                  ) : prepared.status === 'preparing' ? (
                    <p className="text-sm text-muted-foreground">
                      Checking the feed and preparing the exact bytes you will sign…
                    </p>
                  ) : prepared.status === 'blocked' ? (
                    <p className="flex items-start gap-2 text-sm text-destructive">
                      <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                      {prepared.message}
                    </p>
                  ) : signable && prepared.status === 'ready' ? (
                    <>
                      {prepared.mode === 'update' ? (
                        <p className="text-sm text-foreground">
                          A document with this id already exists on the feed and
                          was signed by this wallet — publishing will{' '}
                          <strong>replace</strong> it.
                        </p>
                      ) : null}
                      {prepared.receipts.length > 0 ? (
                        <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
                          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                            Adjustments applied before signing
                          </p>
                          <ul className="space-y-3">
                            {prepared.receipts.map((r, i) => (
                              <li key={i} className="space-y-0.5">
                                <p className="text-sm font-medium text-foreground">{r.title}</p>
                                <p className="text-xs leading-relaxed text-muted-foreground">
                                  {r.description}
                                </p>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      <Button
                        type="button"
                        onClick={handleSignAndPublish}
                        disabled={isPublishing || !signable}
                        className="gap-2 rounded-full"
                      >
                        <PenLine className="size-4" aria-hidden />
                        {isPublishing
                          ? 'Waiting for wallet…'
                          : prepared.mode === 'update'
                            ? 'Sign & replace on feed'
                            : 'Sign & publish'}
                      </Button>
                    </>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}
          </div>
        )}
      </div>
      <Toaster />
    </>
  )
}
