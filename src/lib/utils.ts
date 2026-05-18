import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Slugify a string for URL-safe slugs
 * Based on dp1-feed-v2/internal/executor/executor.go slugify function
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
  const shortId = id.slice(0, 8)
  return `${base}-${shortId}`
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

/** Slug for DP-1 playlist-group (exhibition); aligns with dp1-feed-v2 makeSlug(..., "group"). */
export function generatePlaylistGroupSlug(title: string, id: string, userSlug?: string): string {
  if (userSlug?.trim()) {
    const slugified = slugify(userSlug)
    if (slugified) return slugified
  }

  const base = slugify(title) || 'group'
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
