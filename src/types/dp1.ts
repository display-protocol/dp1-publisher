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

export interface Entity {
  name: string
  key: string // DID format
  url?: string
}

export interface DisplayPrefs {
  scaling?: 'fit' | 'fill' | 'stretch' | 'auto'
  margin?: number | string
  background?: string
  autoplay?: boolean
  loop?: boolean
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
    seriesId?: number
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
  display?: DisplayPrefs
  repro?: ReproBlock
  provenance?: ProvenanceBlock
  note?: Note
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
  // Extension fields (playlists v0.1.0)
  curators?: Entity[]
  summary?: string
  coverImage?: string
  dynamicQuery?: DynamicQuery
  note?: Note
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
