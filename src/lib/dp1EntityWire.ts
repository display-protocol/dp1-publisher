import type { Biography, Entity, Link, Thumbnail } from '@/types/dp1'

/**
 * Wire shape of a DP-1 Entity (core ref-manifest `$defs/Entity`, dp1-go
 * `extension/identity.Entity`). Use for curators, publisher, `note.author`,
 * `links[].authors` and any other place a document names someone, before hashing.
 *
 * Key rules, mirroring dp1-go's struct tags:
 * - `name` is always emitted; `key` is omitted when empty (dp1-go v0.8.0
 *   `key,omitempty`, and the spec makes it optional on curators/publishers).
 * - every other member is `omitempty`: "" and empty arrays are dropped.
 * - only the members the feed's dp1-go declares are emitted. The feed rejects
 *   unknown members with a 400, so this list is also the publisher's guard
 *   against signing a field the feed would refuse. Adding a spec member means
 *   adding it here and to `Entity` in `types/dp1.ts`; omitting one erases it on
 *   every replace, which is the failure this module used to have.
 */

type Obj = Record<string, unknown>

function isObj(v: unknown): v is Obj {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function setStr(out: Obj, k: string, v: unknown, trim = false): void {
  if (typeof v !== 'string') return
  const s = trim ? v.trim() : v
  if (s !== '') out[k] = s
}

function thumbnailWire(t: unknown): Obj | undefined {
  if (!isObj(t)) return undefined
  const x = t as unknown as Thumbnail
  // `uri` is required by the schema; a thumbnail without one is not carried.
  if (typeof x.uri !== 'string' || x.uri === '') return undefined
  const out: Obj = { uri: x.uri }
  if (typeof x.w === 'number') out.w = x.w
  if (typeof x.h === 'number') out.h = x.h
  setStr(out, 'sha256', x.sha256)
  return out
}

function biographyWire(b: unknown): Obj | undefined {
  if (!isObj(b)) return undefined
  const x = b as unknown as Biography
  const out: Obj = { text: typeof x.text === 'string' ? x.text : '' }
  setStr(out, 'source', x.source)
  setStr(out, 'sourceUrl', x.sourceUrl)
  return out
}

/** dp1-go `identity.Link`: `type` and `url` always emitted, the rest omitempty. */
export function linkWire(l: unknown): Obj | undefined {
  if (!isObj(l)) return undefined
  const x = l as unknown as Link
  const out: Obj = { type: x.type, url: x.url }
  setStr(out, 'title', x.title)
  setStr(out, 'date', x.date)
  const thumb = thumbnailWire(x.thumbnail)
  if (thumb) out.thumbnail = thumb
  if (Array.isArray(x.authors) && x.authors.length > 0) {
    out.authors = x.authors.filter(isObj).map((a) => entityWire(a as unknown as Entity))
  }
  return out
}

export function entityWire(e: Entity): Obj & { name: string; key?: string; url?: string } {
  const o: Obj & { name: string; key?: string; url?: string } = { name: typeof e.name === 'string' ? e.name : '' }
  setStr(o, 'key', e.key)
  setStr(o, 'id', e.id)
  setStr(o, 'url', e.url, true)
  setStr(o, 'role', e.role)
  setStr(o, 'location', e.location)
  if (Array.isArray(e.addresses) && e.addresses.length > 0) o.addresses = [...e.addresses]
  const avatar = thumbnailWire(e.avatar)
  if (avatar) o.avatar = avatar
  if (Array.isArray(e.biographies) && e.biographies.length > 0) {
    o.biographies = e.biographies.map(biographyWire).filter(Boolean)
  }
  if (Array.isArray(e.links) && e.links.length > 0) {
    o.links = e.links.map(linkWire).filter(Boolean)
  }
  return o
}
