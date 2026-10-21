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
| `VITE_DP1_EXTENSIONS_ENABLED` | Optional `true` / `false`; when unset, use `GET /api/v1` |
| `VITE_WALLETCONNECT_PROJECT_ID` | Optional; omit to use injected wallet only |
| `VITE_DEBUG_MODE` | Dev server only (`true`): relax playlist URI schemes for Channel validation |
| `VITE_FERALFILE_API_BASE_URL` | Optional Feral File API base for series expand — see [Series expand](#series-expand-vendor-apis) below |
| `VITE_IPFS_GATEWAY_BASE_URL` | Optional IPFS gateway (`…/ipfs`) for objkt media; default `https://ipfs.feralfile.com/ipfs` |

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

## Series expand (vendor APIs)

The **Load from series** panel in the playlist form reads releases directly from three vendor APIs: Feral File, Art Blocks and objkt. There is no indexer dependency. The architecture doc lists the endpoints and rules: [docs/architecture.md](docs/architecture.md#dependencies-on-vendor-apis-series-expand).

Art Blocks and objkt allow any origin, so they work from `npm run dev` unchanged. Feral File refuses the `localhost` origin with a 403, so the dev server proxies `/ff-api` to `https://feralfile.com/api` and strips the `Origin` header (`vite.config.ts`). With `VITE_FERALFILE_API_BASE_URL` unset, dev builds use the proxy and production builds call `https://feralfile.com/api`, which allow-lists `publisher.feralfile.com`.

Releases worth checking after a change:

| Vendor | Slug | Expect |
| ------ | ---- | ------ |
| Feral File | `most-valuable-painting-hng` | 512 mints, 6 artwork pages, not capped |
| Feral File | `data-pilgrims-01-769` | 10 mints |
| Art Blocks | `fidenza-by-tyler-hobbs` | 999 mints, titles `Fidenza #0…`, checksummed contract |
| objkt | `KT1XR4XgBJ2RZz1vW22q6EKdSNgYbmaaWr5z` | 45 mints in numeric order |
| objkt | `KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton` | refused: shared (hic et nunc) contract |

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

## Deploying to publisher.feralfile.com

Three steps, two repos. Nothing deploys automatically on merge — a merged `main` is **not** live until all three happen.

1. **Build the image** (this repo): run `build.yaml` via *Actions → Build → Run workflow*, or `gh workflow run build.yaml -f tag=<suffix>`. The final tag is printed by the run's *Output image tag* step (`dp1-publisher-<suffix>`, or the 12-char SHA when no suffix is given).
2. **Pin the tag** (`feral-file/ff-deploy`, private): set the tag in `ansible/app_defaults/dp1_publisher/config.yml` (`dp1_publisher_image`) and push to `main`.
3. **Deploy**: run ff-deploy's **“Deploy prod-01 — Feed, Publisher, Feral File, Indexer”** workflow (`deploy-feed-feral-file-indexer.yml`). Takes a few minutes; the run must be from a branch containing latest `main`.

Verify: `curl -s https://publisher.feralfile.com/` serves, and the bundle hash in the page's `<script src>` changed. For signing-path changes, publish a small playlist end-to-end through `#/sign` before announcing the deploy — unit tests cannot catch deploy-config problems (env vars, feed URL, WalletConnect project id).

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
