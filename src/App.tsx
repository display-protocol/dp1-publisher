import { WagmiProvider, createConfig, http } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { injected, walletConnect } from 'wagmi/connectors'
import Dashboard from './components/Dashboard'

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

function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <div className="min-h-screen">
          <Dashboard />
        </div>
      </QueryClientProvider>
    </WagmiProvider>
  )
}

export default App
