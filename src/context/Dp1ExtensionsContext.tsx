import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { getFeedApiMetadata } from '@/lib/api'
import { parseEnvExtensionsOverride } from '@/lib/dp1ExtensionPolicy'

export type ExtensionsSource = 'env' | 'feed' | 'default'

interface Dp1ExtensionsValue {
  /** Effective flag for UI + publish path. */
  extensionsEnabled: boolean
  /** True while fetching feed metadata when env override is unset. */
  extensionsLoading: boolean
  /** Where `extensionsEnabled` came from when resolved. */
  extensionsSource: ExtensionsSource
  /** Re-fetch from feed (no-op when env forces on/off). */
  refreshFeedExtensions: () => Promise<void>
}

const Dp1ExtensionsContext = createContext<Dp1ExtensionsValue | null>(null)

export function Dp1ExtensionsProvider({ children }: { children: ReactNode }) {
  const envOverride = useMemo(() => parseEnvExtensionsOverride(), [])
  const [feedEnabled, setFeedEnabled] = useState<boolean | null>(null)
  const [feedUnreachable, setFeedUnreachable] = useState(false)
  const [feedLoading, setFeedLoading] = useState(envOverride === undefined)

  const loadFromFeed = useCallback(async () => {
    if (envOverride !== undefined) {
      setFeedLoading(false)
      return
    }
    setFeedLoading(true)
    setFeedUnreachable(false)
    try {
      const meta = await getFeedApiMetadata()
      setFeedEnabled(meta.extensionsEnabled)
    } catch {
      // CORS/network failures: conservative default (extensions off) until metadata is fetched successfully.
      // This avoids offering extension-only fields when the feed may have extensions disabled.
      setFeedUnreachable(true)
      setFeedEnabled(false)
    } finally {
      setFeedLoading(false)
    }
  }, [envOverride])

  useEffect(() => {
    void loadFromFeed()
  }, [loadFromFeed])

  const extensionsEnabled =
    envOverride !== undefined ? envOverride : feedEnabled === true

  const extensionsSource: ExtensionsSource =
    envOverride !== undefined
      ? 'env'
      : feedUnreachable || feedEnabled === null
        ? 'default'
        : 'feed'

  const value = useMemo(
    (): Dp1ExtensionsValue => ({
      extensionsEnabled,
      extensionsLoading: envOverride === undefined && feedLoading,
      extensionsSource,
      refreshFeedExtensions: loadFromFeed,
    }),
    [
      extensionsEnabled,
      envOverride,
      feedLoading,
      extensionsSource,
      loadFromFeed,
    ],
  )

  return (
    <Dp1ExtensionsContext.Provider value={value}>{children}</Dp1ExtensionsContext.Provider>
  )
}

export function useDp1Extensions(): Dp1ExtensionsValue {
  const ctx = useContext(Dp1ExtensionsContext)
  if (!ctx) {
    throw new Error('useDp1Extensions must be used within Dp1ExtensionsProvider')
  }
  return ctx
}
