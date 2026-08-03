import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Slugify a string for URL-safe slugs
 * Based on slugify in https://github.com/display-protocol/dp1-feed-v2/blob/main/internal/executor/executor.go
 */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Generate a slug from title and UUID
 * If userSlug is provided, use it after slugification
 * Otherwise, generate from title + first 8 chars of UUID
 */
export function generateSlug(title: string, id: string, userSlug?: string): string {
  if (userSlug?.trim()) {
    const slugified = slugify(userSlug)
    if (slugified) return slugified
  }

  const base = slugify(title) || 'playlist'
  // The id suffix is what makes the auto slug collision-resistant in the feed's
  // global slug namespace. When there's no id yet (e.g. a bare fixture), fall
  // back to the base alone rather than emitting a trailing-hyphen slug.
  const shortId = id ? id.slice(0, 8) : ''
  return shortId ? `${base}-${shortId}` : base
}

/**
 * Generate slug for channels
 */
export function generateChannelSlug(title: string, id: string, userSlug?: string): string {
  if (userSlug?.trim()) {
    const slugified = slugify(userSlug)
    if (slugified) return slugified
  }
  
  const base = slugify(title) || 'channel'
  const shortId = id.slice(0, 8)
  return `${base}-${shortId}`
}


/**
 * Truncate Ethereum address for display
 */
export function truncateAddress(address: string): string {
  if (!address) return ''
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}
