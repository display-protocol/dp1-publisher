/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FEED_BASE_URL?: string
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string
  /** Dev server only: relax playlist URL checks for local testing */
  readonly VITE_DEBUG_MODE?: string
  /**
   * When set, forces DP-1 extension UI + publish shape (playlist extension fields, channels).
   * When unset, the app reads `GET /api/v1` `extensionsEnabled` from `VITE_FEED_BASE_URL`.
   */
  readonly VITE_DP1_EXTENSIONS_ENABLED?: string
  /**
   * Feral File public API base for "Load from series". Unset: the dev server uses the
   * Vite proxy path `/ff-api`, production builds call `https://feralfile.com/api`.
   */
  readonly VITE_FERALFILE_API_BASE_URL?: string
  /** IPFS gateway base (…/ipfs) used to turn objkt `ipfs://` media into https sources. */
  readonly VITE_IPFS_GATEWAY_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
