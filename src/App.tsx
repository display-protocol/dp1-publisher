import { useEffect, useState } from 'react'
import { WagmiProvider, createConfig, http } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { injected, walletConnect } from 'wagmi/connectors'
import Dashboard from './components/Dashboard'
import ReviewAndSign from './components/ReviewAndSign'
import { Dp1ExtensionsProvider } from './context/Dp1ExtensionsContext'

/** Must be `VITE_WALLETCONNECT_PROJECT_ID` in `.env` — Vite only exposes vars prefixed with `VITE_`. */
const walletConnectProjectId =
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim() ?? ''

// Configure wagmi for Ethereum mainnet only
const config = createConfig({
  chains: [mainnet],
  connectors: [
    injected(),
    ...(walletConnectProjectId
      ? [
          walletConnect({
            projectId: walletConnectProjectId,
            showQrModal: true,
          }),
        ]
      : []),
  ],
  transports: {
    [mainnet.id]: http(),
  },
})

const queryClient = new QueryClient()

/**
 * Minimal hash router. The app has exactly two surfaces — the composer
 * dashboard and the review-and-sign page — and `#/sign` must work as a
 * shareable link a partner can open directly, which plain component state
 * cannot provide. A router library would be overkill for one branch.
 */
function useIsSignRoute(): boolean {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  return hash === '#/sign'
}

function App() {
  const isSignRoute = useIsSignRoute()
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <div className="min-h-screen">
          <Dp1ExtensionsProvider>
            {isSignRoute ? <ReviewAndSign /> : <Dashboard />}
          </Dp1ExtensionsProvider>
        </div>
      </QueryClientProvider>
    </WagmiProvider>
  )
}

export default App
