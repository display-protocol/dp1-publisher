import { useState } from 'react'
import { Check, Copy, ExternalLink, Plus, Radio } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export type PostPublishKind = 'playlist' | 'channel'
export type PostPublishMode = 'create' | 'update'
export type ExistingChannel = { id: string; title: string }
export type PublishReceipt = { title: string; description: string }

const KIND_LABEL: Record<
  PostPublishKind,
  Record<PostPublishMode, string>
> = {
  playlist: {
    create: 'Playlist published',
    update: 'Playlist updated',
  },
  channel: {
    create: 'Channel published',
    update: 'Channel updated',
  },
}

export default function PostPublishPanel({
  kind,
  mode = 'create',
  feedUrl,
  title,
  receipts = [],
  onUseInNewChannel,
  existingChannels = [],
  onAddToExistingChannel,
  onPublishAnother,
  onViewPublished,
}: {
  kind: PostPublishKind
  /** Whether this document was newly created or updated in place. Adjusts copy
   * so the user knows whether they replaced an existing feed entry. */
  mode?: PostPublishMode
  feedUrl: string
  title?: string
  /** Persistent notes about what the publish pipeline did beyond the user's
   * literal input — wallet identity replacement, curator injection, URL swaps.
   * Surfaces what flashed past in toasts during the sign flow. */
  receipts?: PublishReceipt[]
  /** When provided, renders a "Start a new channel" CTA. Only meaningful when
   * kind === 'playlist' and channel extensions are enabled. */
  onUseInNewChannel?: () => void
  /** Channels the user has already published from this browser. Each renders
   * as a separate "Add to: <title>" CTA. */
  existingChannels?: ExistingChannel[]
  /** Required when existingChannels has entries — fires when the user picks one. */
  onAddToExistingChannel?: (channelId: string) => void
  onPublishAnother: () => void
  onViewPublished: () => void
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(feedUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API unavailable (insecure context, denied permission, etc).
      // The URL is still visible and selectable in the text field.
    }
  }

  return (
    <Card className="border-border/45 shadow-[0_2px_40px_-20px_rgba(15,23,42,0.15)]">
      <CardHeader className="space-y-2 pb-6">
        <p className="section-label">Success</p>
        <div className="space-y-1">
          <CardTitle className="font-display text-2xl font-normal sm:text-[1.75rem]">
            {KIND_LABEL[kind][mode]}
          </CardTitle>
          <CardDescription className="text-[15px]">
            {title
              ? mode === 'update'
                ? `"${title}" replaced the previous version on the feed.`
                : `"${title}" is live on the feed.`
              : mode === 'update'
                ? 'The previous version on the feed has been replaced.'
                : 'Your document is live on the feed.'}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 pb-8">
        <div className="space-y-2">
          <label
            htmlFor="post-publish-feed-url"
            className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
          >
            Feed URL
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
            <input
              id="post-publish-feed-url"
              readOnly
              value={feedUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 rounded-md border border-border/60 bg-muted/30 px-3 py-2 font-mono text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
            <Button
              type="button"
              variant="outline"
              onClick={handleCopy}
              className="gap-2 rounded-md sm:w-32"
              aria-label="Copy feed URL"
            >
              {copied ? (
                <>
                  <Check className="size-4" aria-hidden />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="size-4" aria-hidden />
                  Copy
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              asChild
              className="gap-2 rounded-md sm:w-32"
            >
              <a
                href={feedUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open feed URL in a new tab"
              >
                <ExternalLink className="size-4" aria-hidden />
                Open
              </a>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {kind === 'playlist' ? (
              <>
                Saved to your published list in this browser. Paste this URL
                into a channel's <code className="font-mono">playlists</code>{' '}
                array to reference it.
              </>
            ) : (
              <>
                Saved to your published list in this browser. Open the URL to
                see the channel as the feed exposes it.
              </>
            )}
          </p>
        </div>

        {receipts.length > 0 ? (
          <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Notes on this publish
            </p>
            <ul className="space-y-3">
              {receipts.map((r, i) => (
                <li key={i} className="space-y-0.5">
                  <p className="text-sm font-medium text-foreground">
                    {r.title}
                  </p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {r.description}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {kind === 'playlist' &&
        (onUseInNewChannel ||
          (existingChannels.length > 0 && onAddToExistingChannel)) ? (
          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Use this playlist in a channel
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {onUseInNewChannel ? (
                <Button
                  type="button"
                  onClick={onUseInNewChannel}
                  className="gap-2 rounded-full sm:w-auto"
                >
                  <Plus className="size-4" aria-hidden />
                  Start a new channel
                </Button>
              ) : null}
              {existingChannels.map((ch) => (
                <Button
                  key={ch.id}
                  type="button"
                  variant="outline"
                  onClick={() => onAddToExistingChannel?.(ch.id)}
                  className="gap-2 rounded-full sm:w-auto"
                >
                  <Radio className="size-4 opacity-70" aria-hidden />
                  Add to: {ch.title}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Button
            type="button"
            variant="outline"
            onClick={onPublishAnother}
            className="gap-2 rounded-full sm:w-auto"
          >
            Publish another
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={onViewPublished}
            className="gap-2 rounded-full sm:w-auto"
          >
            View all published
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
