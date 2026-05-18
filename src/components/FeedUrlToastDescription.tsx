/** Clickable full feed URL inside a toast (open in new tab to verify). */
export function FeedUrlToastDescription({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-primary underline underline-offset-2 [word-break:break-word]"
    >
      {url}
    </a>
  )
}
