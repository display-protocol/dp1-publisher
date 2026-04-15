/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FEED_BASE_URL?: string
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string
  /** Dev server only: relax playlist URL checks for local testing */
  readonly VITE_DEBUG_MODE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
