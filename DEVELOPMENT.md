# DEVELOPMENT.md

Contributor notes for **ff-publisher**.

---

## Prerequisites

- **Node.js** 22.10+ and **npm**
- Ethereum wallet (development usually uses Mainnet forks or injected wallet on localhost—see **WalletConnect** note below)

---

## Bootstrap

```bash
cd ff-publisher
npm install
cp .env.example .env
```

Edit `.env`:

| Variable | Purpose |
| -------- | ------- |
| `VITE_FEED_BASE_URL` | Feed API origin (`https://…`), no trailing slash |
| `VITE_DP1_EXTENSIONS_ENABLED` | Optional `true` / `false`; when unset, use `GET /api/v1` |
| `VITE_WALLETCONNECT_PROJECT_ID` | Optional; omit to use injected wallet only |
| `VITE_DEBUG_MODE` | Dev server only (`true`): relax playlist URI schemes for Channel validation |

URI rules and dev-only relaxations: [`validatePlaylistURI` / `isDebugMode`](src/lib/api.ts) in `src/lib/api.ts`.

---

## Common commands

| Command | Meaning |
| ------- | ------- |
| `npm run dev` | Vite dev server (default `http://localhost:5173`) |
| `npm run build` | `tsc` then production bundle to `dist/` |
| `npm run preview` | Serve production build locally |
| `npm run lint` | ESLint over the workspace |

---

## Project layout

- `src/App.tsx` — wagmi chain config (Ethereum mainnet), providers
- `src/components/` — UI and publish flows (`Dashboard`, forms)
- `src/lib/api.ts` — feed HTTP client
- `src/lib/signing.ts` — JCS, digest, EIP-191 signing helpers
- `src/types/dp1.ts` — DP-1-aligned TS types

Conceptual layering and flows: **[docs/architecture.md](docs/architecture.md)**

---

## Working with another feed checkout

Clone **dp1-feed-v2**, run locally, and point the publisher:

```bash
# example
VITE_FEED_BASE_URL=http://localhost:8080
```

Ensure CORS/network allows browser origin (dev server defaults to localhost). If `/api/v1` is unreachable during extensions probe, UI falls back to “extensions enabled” behavior—prefer a reachable metadata endpoint when testing toggles.

Http contract parity: **`dp1-feed-v2/api/openapi.yaml`** and **`dp1-feed-v2/docs/api_design.md`**.

---

## Docker smoke test

See **README § Docker**. Build args map to `VITE_*` embedding at compile time—not runtime env for static nginx.

---

## Pull request checklist

- `npm run lint` clean  
- `npm run build` clean (TypeScript passes)  
- If behavior crosses feed boundaries, update **`docs/`** and **README** in the same PR when appropriate

Coding style pointers: **`docs/typescript_coding_standards.md`**

---

## Further reading

- [README.md](README.md) — overview, Docker, usage
- [docs/architecture.md](docs/architecture.md)
