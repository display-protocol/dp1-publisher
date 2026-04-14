import { useMemo } from 'react'
import type { Connector } from 'wagmi'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { Wallet, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { truncateAddress } from '@/lib/utils'
import { mainnet } from 'wagmi/chains'
import { useToast } from '@/hooks/use-toast'

function hasBrowserEthereumProvider(): boolean {
  return typeof window !== 'undefined' && Boolean(window.ethereum)
}

export default function WalletConnect() {
  const { toast } = useToast()
  const { address, isConnected, chain } = useAccount()
  const { disconnect } = useDisconnect()

  const { connect, connectors, isPending, reset, variables } = useConnect({
    mutation: {
      onError(err) {
        const message =
          err instanceof Error ? err.message : 'Could not connect to a wallet.'
        toast({
          title: 'Connection failed',
          description: message,
          variant: 'destructive',
        })
      },
    },
  })

  const walletConnectConnector = useMemo(
    () => connectors.find((c) => c.id === 'walletConnect'),
    [connectors],
  )
  const injectedConnector = useMemo(
    () => connectors.find((c) => c.id === 'injected'),
    [connectors],
  )

  const wcConfigured = Boolean(import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim())

  const pendingConnector = variables?.connector
  const pendingId =
    isPending && pendingConnector && typeof pendingConnector !== 'function'
      ? (pendingConnector as Connector).id
      : undefined

  const isWrongNetwork = isConnected && chain?.id !== mainnet.id

  if (isConnected && address) {
    return (
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:gap-4">
        {isWrongNetwork && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-destructive/25 bg-destructive/5 px-3 py-1 text-xs font-medium text-destructive">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            Switch to Ethereum mainnet
          </span>
        )}
        <div className="flex items-center gap-3 rounded-full border border-border/60 bg-card/90 px-1 py-1 pl-4 shadow-sm backdrop-blur-sm">
          <div className="flex flex-col gap-0.5 pr-1 text-right">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Connected
            </span>
            <span className="font-mono text-xs font-medium tabular-nums text-foreground">
              {truncateAddress(address)}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-9 rounded-full border-0 bg-muted/80 px-4 text-xs font-medium shadow-none hover:bg-muted"
            onClick={() => disconnect()}
          >
            Disconnect
          </Button>
        </div>
      </div>
    )
  }

  if (!walletConnectConnector && !injectedConnector) {
    return (
      <p className="text-center text-sm text-muted-foreground">
        No wallet connectors available.
      </p>
    )
  }

  const configHint =
    !hasBrowserEthereumProvider() && !wcConfigured ? (
      <p className="max-w-sm text-center text-xs leading-relaxed text-muted-foreground">
        No browser wallet detected. Add{' '}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
          VITE_WALLETCONNECT_PROJECT_ID
        </code>{' '}
        to <code className="font-mono text-[11px]">.env</code> and restart{' '}
        <code className="font-mono text-[11px]">npm run dev</code>.
      </p>
    ) : null

  const showBoth = Boolean(walletConnectConnector && injectedConnector)

  return (
    <div className="flex flex-col items-center gap-3">
      {walletConnectConnector && (
        <Button
          className="h-11 gap-2 rounded-full px-7 text-sm font-medium shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-all hover:shadow-[0_4px_20px_-8px_rgba(15,23,42,0.25)]"
          disabled={isPending}
          onClick={() => {
            reset()
            connect({ connector: walletConnectConnector, chainId: mainnet.id })
          }}
        >
          <Wallet className="size-4 opacity-80" aria-hidden />
          {pendingId === 'walletConnect' && isPending
            ? 'Connecting…'
            : showBoth
              ? 'WalletConnect'
              : 'Connect with WalletConnect'}
        </Button>
      )}
      {showBoth && injectedConnector && (
        <Button
          variant="outline"
          className="h-10 gap-2 rounded-full px-6 text-xs font-medium"
          disabled={isPending}
          onClick={() => {
            reset()
            connect({ connector: injectedConnector, chainId: mainnet.id })
          }}
        >
          {pendingId === 'injected' && isPending ? 'Connecting…' : 'Browser extension'}
        </Button>
      )}
      {!showBoth && injectedConnector && !walletConnectConnector && (
        <Button
          className="h-11 gap-2 rounded-full px-7 text-sm font-medium shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-all hover:shadow-[0_4px_20px_-8px_rgba(15,23,42,0.25)]"
          disabled={isPending}
          onClick={() => {
            reset()
            connect({ connector: injectedConnector, chainId: mainnet.id })
          }}
        >
          <Wallet className="size-4 opacity-80" aria-hidden />
          {pendingId === 'injected' && isPending ? 'Connecting…' : 'Connect wallet'}
        </Button>
      )}
      {configHint}
    </div>
  )
}
