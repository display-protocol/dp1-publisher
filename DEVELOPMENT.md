# DEVELOPMENT.md

Contributor notes for **dp1-publisher**.

---

## Prerequisites

- **Node.js** 22.10+ and **npm**
- Ethereum wallet (development usually uses Mainnet forks or injected wallet on localhost—see **WalletConnect** note below)

---

## Bootstrap

```bash
cd dp1-publisher
npm install
cp .env.example .env
```

Edit `.env`:

| Variable | Purpose |
| -------- | ------- |
| `VITE_FEED_BASE_URL` | Feed API origin (`https://…`), no trailing slash |
| `VITE_INDEXER_BASE_URL` | ff-indexer-v2 origin for series expand — see [Series expand](#series-expand-vite_indexer_base_url) below |
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
| `npm run test` | Vitest unit tests (single run) |
| `npm run test:coverage` | Vitest + v8 coverage (`coverage/`, gitignored) |

---

## Project layout

- `src/App.tsx` — wagmi chain config (Ethereum mainnet), providers
- `src/components/` — UI and publish flows (`Dashboard`, forms)
- `src/lib/api.ts` — feed HTTP client
- `src/lib/signing.ts` — JCS, digest, EIP-191 signing helpers
- `src/types/dp1.ts` — DP-1-aligned TS types

Conceptual layering and flows: **[docs/architecture.md](docs/architecture.md)**

---

## Series expand (`VITE_INDEXER_BASE_URL`)

The **Load from series** feature in the playlist form calls `VITE_INDEXER_BASE_URL/graphql` to resolve FF series / AB projects and fetch mint-ordered tokens. It requires **ff-indexer-v2** with the series-expand API:

- `Query.releases(vendor, vendor_release_id, limit)` — resolve a release by vendor key
- `Query.tokens(release_id, sort_by: mint_number, sort_order: asc, limit)` — fetch mint-ordered members

This API surface was added in [ff-indexer-v2 #93](https://github.com/feral-file/ff-indexer-v2/issues/93). If your configured endpoint predates that change, the **Load** button will return a GraphQL error and the form will display it inline. To develop against a compatible indexer locally:

```bash
# in .env, point to a local ff-indexer-v2 with the series-expand API
VITE_INDEXER_BASE_URL=http://localhost:8081
```

---

## Working with another feed checkout

Clone **[dp1-feed-v2](https://github.com/display-protocol/dp1-feed-v2)**, run locally, and point the publisher:

```bash
# example
VITE_FEED_BASE_URL=http://localhost:8080
```

Ensure CORS/network allows browser origin (dev server defaults to localhost). If `/api/v1` is unreachable during extensions probe, UI falls back to “extensions enabled” behavior—prefer a reachable metadata endpoint when testing toggles.

HTTP contract parity: [`api/openapi.yaml`](https://github.com/display-protocol/dp1-feed-v2/blob/main/api/openapi.yaml) and [`docs/api_design.md`](https://github.com/display-protocol/dp1-feed-v2/blob/main/docs/api_design.md) in [dp1-feed-v2](https://github.com/display-protocol/dp1-feed-v2).

---

## Docker smoke test

See **README** (Docker). Build args map to `VITE_*` embedding at compile time—not runtime env for static nginx.

---

## Continuous integration / delivery

GitHub Actions live under **`.github/workflows/`** (mostly **`main`** / **`develop`**; path filters skip unrelated edits).

| Workflow | Purpose |
| -------- | ------- |
| **`lint.yaml`** | `npm ci`, ESLint (`npm run lint`), markdownlint on `**/*.md` |
| **`test.yaml`** | `npm ci`, **`npm run test:coverage`** (Vitest + v8); publishes a **coverage** job summary table and uploads **`coverage-report`** (HTML, LCOV, JSON). |
| **`build.yaml`** | **Manual only** (`workflow_dispatch`): **`npm ci` + `npm run build`**, then **Docker** build/push with **`VITE_FEED_BASE_URL`** (default `https://feed.feralfile.com`, aligned with ff-deploy **`dp1_feed.public_base_url`**), **`VITE_DP1_EXTENSIONS_ENABLED`** (default `true` via workflow env, overridable by repository variable or dispatch input `extensions_enabled`: `workflow-default`, `follow-feed`, `true`, `false`), and **`VITE_WALLETCONNECT_PROJECT_ID`** from repo secret. Pushes **`dp1-publisher-*`** (optional tag suffix or 12-char SHA) to DOCR. Requires **`DIGITALOCEAN_DOCR_TOKEN`**; set **`VITE_WALLETCONNECT_PROJECT_ID`** for WalletConnect. Pin the tag in ff-deploy **`ansible/app_defaults/dp1_publisher/config.yml`** after the run. |
| **`gitleaks.yaml`** | [Gitleaks](https://github.com/gitleaks/gitleaks) secret scan |

Path filters mirror **[dp1-feed-v2](https://github.com/display-protocol/dp1-feed-v2)**–style CI so only relevant workflows re-run when touched files change.

---

## Pull request checklist

- `npm run lint` clean  
- `npm run build` clean (TypeScript passes)  
- If behavior crosses feed boundaries, update **`docs/`** and **README** in the same PR when appropriate

Coding style pointers: **`docs/typescript_coding_standards.md`**

---

## Further reading

- [README.md](README.md) — overview, Docker, usage
- [AGENTS.md](AGENTS.md) — agent/repository contract (Cursor rules under [`.cursor/rules/`](.cursor/rules/))
- [PLANS.md](PLANS.md) — when to write an execution plan before large work
- [`scripts/agent-helpers/post-implementation-checks`](scripts/agent-helpers/post-implementation-checks) — local gate matching CI (`npm run lint`, `npm run build`)
- [docs/architecture.md](docs/architecture.md)
