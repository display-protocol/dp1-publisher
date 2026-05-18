# DP-1 Publisher Dashboard

[![Tests](https://github.com/display-protocol/dp1-publisher/actions/workflows/test.yaml/badge.svg)](https://github.com/display-protocol/dp1-publisher/actions/workflows/test.yaml) [![Lint](https://github.com/display-protocol/dp1-publisher/actions/workflows/lint.yaml/badge.svg)](https://github.com/display-protocol/dp1-publisher/actions/workflows/lint.yaml) [![Codecov](https://codecov.io/gh/display-protocol/dp1-publisher/graph/badge.svg)](https://codecov.io/gh/display-protocol/dp1-publisher)

A browser dashboard for composing and publishing DP-1 **playlists**, **playlist-groups**, and (when enabled) **channels** to a [DP-1 Feed](https://github.com/display-protocol/dp1) HTTP API—using **Ethereum wallet EIP-191** signatures rather than operator API keys.

## Documentation

| Doc | Contents |
| --- | -------- |
| [docs/architecture.md](docs/architecture.md) | App layout, signing flow boundaries, responsibilities |
| [docs/typescript_coding_standards.md](docs/typescript_coding_standards.md) | Coding conventions |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Contributor setup, env vars, QA checklist |

Authoritative HTTP contract lives in **[dp1-feed-v2](https://github.com/display-protocol/dp1-feed-v2)**: [`api/openapi.yaml`](https://github.com/display-protocol/dp1-feed-v2/blob/main/api/openapi.yaml) plus [`docs/api_design.md`](https://github.com/display-protocol/dp1-feed-v2/blob/main/docs/api_design.md).

## Features

- **Wallet connection**: Ethereum **mainnet** only (wagmi)—injected or optional WalletConnect
- **Playlist publishing**: Forms or JSON editor; curator keys; playlists extension (`note`, dynamic query paths) follow feed policy
- **Playlist groups (“exhibitions”)**: Compose and publish grouped playlists
- **Channels**: Visible when deployment reports `extensionsEnabled` (or forced via env)
- **PATCH updates**: Publish view lists prior work per wallet; edits refetch authoritative documents via GET before merge/sign
- **URI checks**: Playlist item URIs validated for HTTPS/IPFS reachability UX (optional dev overrides)
- **DP-1 signing**: Strip signatures → JCS (RFC 8785) → SHA-256 over canonical bytes + `\n` → EIP-191 personal sign (`did:pkh` identifiers)

## Tech stack

Vite · React · TypeScript · Tailwind · shadcn/ui · wagmi · viem · TanStack Query · `canonicalize` (JCS)

## Getting started

### Prerequisites

- Node.js **22.10+** and npm
- Ethereum wallet (MetaMask, WalletConnect-compatible, …)
- A reachable DP-1 Feed (default build targets Feral File public feed unless overridden)

### Install

```bash
npm install
cp .env.example .env
# Optional: VITE_WALLETCONNECT_PROJECT_ID from https://cloud.walletconnect.com/
```

### Development server

```bash
npm run dev
# Open http://localhost:5173
```

### Production build

```bash
npm run build
npm run preview
```

### Docker

Multi-stage image: Node builds static assets → nginx serves `dist/`. Pinned digest details are in [`Dockerfile`](Dockerfile).

```bash
docker build -t dp1-publisher .
docker run --rm -p 8080:80 dp1-publisher
```

Embed feed origin and WalletConnect at **build time**:

```bash
docker build -t dp1-publisher \
  --build-arg VITE_FEED_BASE_URL=https://feed.example.com \
  --build-arg VITE_WALLETCONNECT_PROJECT_ID=your_walletconnect_project_id \
  .
```

## Usage highlights

See [DEVELOPMENT.md](DEVELOPMENT.md) for environment nuances and feed-local development.

### Publishing

1. **Connect wallet**
2. **Publish** tabs: Playlist, Group (and Channel when extensions are on)—use forms or paste JSON where offered
3. **Sign & publish** submits `POST /api/v1/...` with non-empty signatures
4. **Published**: local per-wallet registry (browser `localStorage`) for shortcuts; edits always reload from GET before PATCH + re-sign

### Extensions

Channels and playlists extension UI follow **`GET /api/v1`** `extensionsEnabled` unless `VITE_DP1_EXTENSIONS_ENABLED` overrides—see [.env.example](.env.example).

## Signing flow (summary)

Aligned with DP-1 signing bytes and verified by the feed:

1. Strip `signature` / `signatures`
2. Stabilize JSON (avoid `undefined` drift vs wire form)
3. Canonicalize (**JCS**, RFC 8785)
4. Append newline (`0x0A`) → hash **SHA-256**
5. **EIP-191** personal sign digest; emit `kid` `did:pkh:eip155:1:<checksummed address>`

Details: [`src/lib/signing.ts`](src/lib/signing.ts) and [docs/architecture.md](docs/architecture.md).

## Slug conventions

Feeds derive slug from optional client slug or title plus short ID on create; publishers provide `slug`/`title` in line with DP-1/feed executor rules—not reimplemented verbatim here.

## Endpoint subset (SPA)

Creates and PATCH updates use **`/api/v1/playlists`**, **`playlist-groups`**, **`channels`**. Reads use GET/list for edit flows.

Full HTTP contract: **[dp1-feed-v2](https://github.com/display-protocol/dp1-feed-v2)** [`api/openapi.yaml`](https://github.com/display-protocol/dp1-feed-v2/blob/main/api/openapi.yaml) and [`docs/api_design.md`](https://github.com/display-protocol/dp1-feed-v2/blob/main/docs/api_design.md). Feed calls from this SPA are centralized in [`src/lib/api.ts`](src/lib/api.ts).

## Security

- **Production** playlist-item URIs: **https:** and **ipfs:** only; private/local blocked in UI validation (`src/lib/api.ts`).
- **`VITE_DEBUG_MODE=true`** (Vite dev only) additionally allows `http:` for experimentation.
- **No API keys** in the SPA path—wallet signatures only.

## License

See [LICENSE](LICENSE).
