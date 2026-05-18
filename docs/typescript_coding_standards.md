# TypeScript / React Coding Standards

This repository favors clarity, predictable boundaries, and behavior aligned with the DP-1 Feed contract. Guidance parallels the Go coding standards in **[dp1-feed-v2](https://github.com/display-protocol/dp1-feed-v2)** ([`docs/go_coding_standards.md`](https://github.com/display-protocol/dp1-feed-v2/blob/main/docs/go_coding_standards.md)—read beside this appendix when hopping between repos).

## Primary references

- TypeScript handbook and **strict typing** idioms  
- ESLint defaults in `eslint.config.js` + **`npm run lint`**
- React 18 docs (hooks, component purity)

---

## Structure and layering

- **Components** (`src/components/`): Present forms and orchestrate user flows; delegate HTTP to `src/lib/api.ts` and crypto to `src/lib/signing.ts`.
- **Types** (`src/types/`): DP-1 and feed-aligned shapes shared across UI and API helpers.
- **Avoid** burying fetch or signing logic deeply inside unrelated UI helpers—centralize reuse in `lib/`.

---

## Naming

- Use **`camelCase`** for values/functions, **`PascalCase`** for components/types.
- Prepend hooks with **`use`**.
- Boolean names prefer forms like `isLoading`, `hasMore`, `extensionsEnabled`.

---

## Comments

Add comments where future maintainers could otherwise misalign with DP-1 or the feed:

- signing / canonicalization invariants (`signing.ts`, payload builders)
- why refetch-before-PATCH matters (`publishedStorage.ts`)
- extensions fallbacks (`Dp1ExtensionsContext.tsx`)

Avoid narrating obvious JSX or trivial assignments.

---

## Errors and UX

- Use **`FeedAPIError`** for failed feed calls; propagate `status` and stable `error` for branching and toasts where appropriate.
- Do not swallow failures without user-visible or logged diagnostics.
- Prefer **controlled** parsing with explicit types (`as Type` sparingly)—validate at boundaries where the feed shape is loosely typed (`Record<string, unknown>` PATCH bodies).

---

## React patterns

- Keep side-effectful flows (wallet, fetch) explicit in effects or handlers; avoid staleness bugs on edit flows (use keys or deliberate refetches when swapping `editId`).
- Context (`Dp1ExtensionsProvider`) exposes **narrow** getters; hooks throw if mis-wired (`useDp1Extensions`).

---

## Security and environment

- **Never access** non-`VITE_*` secrets in browser code—they are unavailable and should not ship to clients anyway.
- Do not widen URI allowlists (`validatePlaylistURI`) without updating docs and guarding behind dev-only toggles already in place.

---

## Testing posture

(Add tests where behavior is brittle—signing/canonical JSON, URI validation, merge helpers. The codebase may grow Vitest/Jest; until then **`npm run build`** performs `tsc` plus the Vite production bundle.)

For the same gate CI and agents expect, run **`scripts/agent-helpers/post-implementation-checks`** from the repo root after `npm ci` / `npm install`.

---

## Formatting and linting

Run **`npm run lint`** before commit/PR.

Editor integration (ESLint VS Code/Cursor recommended) catches most issues locally.
