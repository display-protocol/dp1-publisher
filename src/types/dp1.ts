/**
 * DP-1 Type Definitions
 * Based on dp1-go/internal/schema
 */

export type LicenseMode = 'open' | 'token' | 'subscription'

export type SignatureAlgorithm = 'ed25519' | 'eip191' | 'ecdsa-secp256k1' | 'ecdsa-p256'

export type SignatureRole = 'curator' | 'feed' | 'agent' | 'institution' | 'licensor' | 'publisher'

export interface Signature {
  alg: SignatureAlgorithm
  kid: string // DID format: did:key:... or did:pkh:eip155:1:0x...
  ts: string // RFC3339 timestamp
  payload_hash: string // sha256:hex
  role: SignatureRole
  sig: string // base64url (no padding)
}

/** Image reference shared by entity avatars and link thumbnails (core ref-manifest `Thumbnail`). */
export interface Thumbnail {
  uri: string
  w?: number
  h?: number
  sha256?: string
}

export interface Biography {
  text: string
  source?: string
  sourceUrl?: string
}

export type LinkType =
  | 'website'
  | 'twitter'
  | 'instagram'
  | 'profile'
  | 'publication'
  | 'article'
  | 'event'
  | 'news'
  | 'other'

/** External link (core ref-manifest `Link`); on a playlist it is editorial content about it. */
export interface Link {
  type: LinkType | string
  url: string
  title?: string
  date?: string // RFC3339
  thumbnail?: Thumbnail
  authors?: Entity[]
}

/**
 * One model for every place DP-1 names someone (core ref-manifest `$defs/Entity`,
 * dp1-go `extension/identity.Entity`). Only `name` is required by the schema;
 * `key` is a DID when present. The profile fields are a snapshot taken at
 * authoring time and are carried verbatim so a replace never erases them.
 */
export interface Entity {
  name: string
  key?: string // DID format
  id?: string
  url?: string // deprecated in favour of `links`
  role?: string
  location?: string
  addresses?: string[]
  avatar?: Thumbnail
  biographies?: Biography[]
  links?: Link[]
}

export interface DisplayPrefs {
  scaling?: 'fit' | 'fill' | 'stretch' | 'auto'
  margin?: number | string
  background?: string
  autoplay?: boolean
  loop?: boolean
  imageRendering?: 'auto' | 'pixelated'
  interaction?: {
    keyboard?: string[]
    mouse?: {
      click?: boolean
      scroll?: boolean
      drag?: boolean
      hover?: boolean
    }
  }
  userOverrides?: Record<string, boolean>
}

export interface ReproBlock {
  engineVersion?: {
    chromium?: string
    webkit?: string
    gecko?: string
  }
  seed?: string
  assetsSHA256?: string[]
  frameHash?: {
    sha256?: string
    phash?: string
  }
}

export interface ProvenanceBlock {
  type: 'onChain' | 'seriesRegistry' | 'offChainURI'
  contract?: {
    chain?: 'evm' | 'tezos' | 'bitmark' | 'other'
    standard?: 'erc721' | 'erc1155' | 'fa2' | 'other'
    address?: string
    // A number, or a decimal string when the id exceeds 2^53 (spec.md §provenance).
    seriesId?: number | string
    tokenId?: string
    uri?: string
    metaHash?: string
  }
  dependencies?: Array<{
    chain?: string
    standard?: string
    uri?: string
  }>
}

export interface Note {
  text: string
  duration?: number // seconds, default 20
  title?: string
  author?: Entity
}

/** Playlists-extension §3.8: a smaller playlist published around the parent. */
export interface Satellite {
  playlist: string // URI
  kind: string
  title?: string
  note?: string
}

export interface ResponseMapping {
  itemsPath: string // JSON path to array (dot notation)
  itemSchema: string // dp1/1.0 or dp1/1.1
  itemMap?: Record<string, string> // Optional field mapping
}

export interface DynamicQuery {
  profile: 'https-json-v1' | 'graphql-v1'
  endpoint: string // URI
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  query?: string // Query payload with {{...}} template placeholders
  responseMapping: ResponseMapping
}

export interface PlaylistItem {
  id?: string // UUID v4
  slug?: string
  title?: string
  source: string // URI
  duration?: number // seconds
  license?: LicenseMode
  ref?: string // URI
  override?: Record<string, unknown>
  // Integrity hash of the manifest at `ref` (playlists-extension §3.6); signed
  // with the document so a mutable HTTPS manifest cannot change underneath it.
  refHash?: string
  // Playlists-extension §3.6 (dp1-go v0.6.0 PlaylistItem.InlineManifest): a
  // complete Ref Manifest carried inline instead of hosted behind `ref`. Typed
  // as an open shape like `override` because dp1-go holds it as
  // `json.RawMessage` and never decodes it — its bytes are covered by the
  // playlist signature with no `refHash` counterpart, so decoding and
  // re-encoding would drop present-but-empty fields (the artist `"id": ""` in
  // the §3.6 example) and change the JCS payload. Anything narrower here would
  // invite code that reshapes a document we are only allowed to carry.
  inlineManifest?: Record<string, unknown>
  display?: DisplayPrefs
  repro?: ReproBlock
  provenance?: ProvenanceBlock
  note?: Note
  // Playlists-extension §3.5.2 scheduling (dp1-go v0.5.1+): local datetime with
  // seconds and no timezone, or RFC 3339 with Z/colon offset. The feed only
  // validates the format under extension validation; it does not compute the
  // active set, so this is stored item metadata from the publisher's view.
  displayAt?: string
  // Content Rating Extension v0.1.0 (dp1 extensions/content-rating): the
  // curator's audience label for this item, covered by the playlist signature.
  // Open vocabulary on the wire (`general` and `mature` are defined); typed as
  // string so a label from a newer extension revision is carried, not dropped.
  contentRating?: string
  // Free-text reasons in the curator's own words; each entry non-empty.
  contentReasons?: string[]
}

export interface PlaylistDefaults {
  display?: DisplayPrefs
  license?: LicenseMode
  duration?: number
}

export interface Playlist {
  dpVersion: string
  id?: string // UUID v4
  slug?: string
  title: string
  created?: string // RFC3339
  defaults?: PlaylistDefaults
  items: PlaylistItem[]
  signatures?: Signature[]
  signature?: string // Legacy v1.0.x
  // Extension fields (playlists v0.2.0)
  curators?: Entity[]
  summary?: string
  coverImage?: string
  dynamicQuery?: DynamicQuery
  note?: Note
  // Playlists-extension fields below were once dropped by the signing whitelist
  // (see playlistSignPayload.ts). `visibility` is the one that matters most:
  // absent means public, so losing "unlisted" on a replace publishes it.
  openAt?: string // §3.5.2 date shape; playlist-level event time, not scheduling
  links?: Link[]
  visibility?: string // open vocabulary; "public", or anything else = unlisted
  satellites?: Satellite[]
}


export interface Channel {
  id?: string
  slug?: string
  title: string
  version: string
  created?: string
  playlists: string[] // URIs
  curators?: Entity[]
  publisher?: Entity
  summary?: string
  coverImage?: string
  signatures?: Signature[]
}

// Form data types (before transformation to DP-1 format)
export interface PlaylistFormData {
  title: string
  slug?: string
  summary?: string
  coverImage?: string
  curators: Entity[]
  defaults?: PlaylistDefaults
  items: PlaylistItem[]
}

export interface ChannelFormData {
  title: string
  slug?: string
  version: string
  summary?: string
  coverImage?: string
  publisher: Entity
  curators?: Entity[]
  playlists: string[] // URIs
}
