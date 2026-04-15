import type { Entity } from '@/types/dp1'

/**
 * Mirrors `github.com/display-protocol/dp1-go/extension/identity`.Entity:
 * only `url` has `json:"url,omitempty"`; `name` and `key` are always emitted (may be "").
 * Use this for curators, publisher, and any other wire Entity before hashing.
 */
export function entityWire(e: Entity): { name: string; key: string; url?: string } {
  const o: { name: string; key: string; url?: string } = {
    name: e.name,
    key: e.key,
  }
  const u = e.url?.trim()
  if (u) o.url = u
  return o
}
