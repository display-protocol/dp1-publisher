# Architecture

**dp1-publisher** is a single-page application (SPA) used to compose DP-1 documents and publish them to a **DP-1 Feed** HTTP API using **wallet-based (EIP-191) signatures**. It does not run a feed server itself; all durable state and validation happen on the feed.

**Design philosophy:** keep publishing flows in the browser, isolate HTTP and signing in small modules, and mirror feed semantics (especially extensions and signature rules) rather than inventing parallel behavior.

```text
Publisher (browser) ──► Feed API ──► PostgreSQL
   │  Vite/React       (DP-1 Feed server — https://github.com/display-protocol/dp1-feed-v2)
   │  wagmi + viem
   └── localStorage (published list UX only)
```

---

## Responsibility boundaries

| Area | Location | Role |
| ---- | -------- | ---- |
| **Entry / shell** | `src/main.tsx`, `src/App.tsx` | Bootstrap React, wagmi chain config (Ethereum mainnet), TanStack Query, extensions provider. |
| **Layouts / screens** | `src/components/Dashboard.tsx` | Connect gate, Publish vs Published navigation, tabs for Playlist / Group / Channel when extensions permit. |
| **Forms & editors** | `src/components/PlaylistForm.tsx`, `PlaylistGroupForm.tsx`, `ChannelForm.tsx` | Composer UI, JSON editor paths. Forms resolve a *raw document* from form state or pasted JSON, then route it through the publish-preparation boundary below — they no longer build wire JSON or run canonicalization themselves. |
| **Publish preparation** | `src/lib/preparePublish.ts` | **Single chokepoint** for the `raw document → signed bytes + wire body` pipeline. Merges with base (edit), strips extensions when off, ensures the connected wallet is declared as signer (`curators[]` for playlist, `publisher.key` for channel), validates, then canonicalizes once via `*UnsignedPayloadForSigning` and derives the wire body from that canonical form. **Invariant:** CREATE wire body equals signed bytes; PATCH wire body equals signed bytes minus `id` and `created` (the only documented PATCH omissions). |
| **Published registry (local)** | `src/components/PublishedView.tsx`, `src/lib/publishedStorage.ts` | Per-wallet list metadata in `localStorage`; edits always refetch via GET—never PATCH from stale cache alone. |
| **Feed HTTP client** | `src/lib/api.ts` | Base URL helpers, GET metadata, POST create, PATCH update, GET list/detail, playlist URI helpers. Throws `FeedAPIError` with status + stable `error` code when present. |
| **DP-1 signing** | `src/lib/signing.ts`, `*SignPayload.ts` | Strip signatures, JCS canonicalize (RFC 8785), newline-terminated signing bytes, SHA-256 digest, EIP-191 personal sign via wagmi wallet client; build `kid` (`did:pkh:…`). `*UnsignedPayloadForSigning` whitelists typed top-level fields so unknown imported-JSON keys can't survive into hashed bytes (the feed reconstructs a typed struct that drops them). |
| **Signer-identity helpers** | `src/lib/dp1WalletSigner.ts` | `ensurePlaylistWalletCurator` / `ensureChannelWalletPublisher`: declare the connected wallet as a signer on a document before signing, defensively normalizing malformed entities from the JSON boundary. |
| **Field validation** | `src/lib/channelValidation.ts`, inline playlist gate in `preparePublish.ts` | Defensive checks that run before signing on both Form-tab and JSON-tab paths. |
| **Merge helpers** | `src/lib/dp1Merge.ts`, `dp1EntityWire.ts` | Server-aligned partial document shapes before PATCH/sign. |
| **Extension policy** | `src/context/Dp1ExtensionsContext.tsx`, `src/lib/dp1ExtensionPolicy.ts` | Effective `extensionsEnabled` from env override or `GET /api/v1`; gates Channel UI and playlist extension fields. |
| **Types** | `src/types/dp1.ts` | Shared shapes aligned with DP-1 / feed JSON. |

---

## Data flow (publish)

1. The form resolves a **raw document** from form state (Form tab) or parsed imported JSON (JSON tab).
2. `preparePublish.ts` runs the pipeline:
   - merge with base if editing (otherwise pass through),
   - strip extension fields when extensions are off (playlist),
   - ensure the connected wallet is declared as the signer (`curators[]` for playlist, `publisher.key` for channel),
   - validate field rules,
   - canonicalize **once** via `*UnsignedPayloadForSigning` — the single source of truth for the bytes the feed will hash. The canonicalizer whitelists typed top-level fields, so unknown imported-JSON keys are dropped at this boundary.
3. The form receives `{ signedPayload, signedBytes, wireBody, toasts }`. It passes `signedBytes` directly to `signDocument` and POSTs/PATCHes `{ ...wireBody, signatures }`.
4. The completed document is sent with `POST /api/v1/...` or `PATCH /api/v1/.../{id}` as implemented in `api.ts`.
5. The feed validates, may add feed-operator signatures, persists, and returns the stored document.

**Invariant** (enforced by `preparePublish.ts`, tested in `preparePublish.test.ts`):
- **CREATE**: `wireBody === signedBytes` — the POST body equals the bytes that were hashed, so the feed verifies the signature against exactly what we sent.
- **PATCH**: `wireBody === signedBytes` minus `{ id, created }`. `id` is in the URL path; `created` is immutable. These are the only intentional omissions.

`wireBody` is derived from `signedBytes` directly (not built in parallel) — drift between them is structurally impossible at this layer.

**PATCH:** signatures must verify against the **merged** stored document overlaid with patch fields—the app refetches GET before merging for edit flows (see `publishedStorage.ts` comments).

---

## Dependencies on the feed

- **Base URL:** `VITE_FEED_BASE_URL` at build/dev time (see `.env.example`). Default fallback in code is production Feral File feed unless overridden.
- **Extensions:** Channel routes and playlist extension-dependent UI align with **`GET /api/v1`** (`extensionsEnabled`) unless **`VITE_DP1_EXTENSIONS_ENABLED`** forces on/off locally.
- **Contract:** HTTP paths, payloads, errors, ETag semantics, and pagination are defined by **[dp1-feed-v2](https://github.com/display-protocol/dp1-feed-v2)** ([OpenAPI](https://github.com/display-protocol/dp1-feed-v2/blob/main/api/openapi.yaml), [API design](https://github.com/display-protocol/dp1-feed-v2/blob/main/docs/api_design.md)). This app implements a **subset** of calls needed for dashboard workflows; treat that repository as normative.

---

## Security posture (browser)

- **Playlist item URIs** in Channel flows: validated in-browser (`validatePlaylistURI`); production allows **https://** and **ipfs://** only and blocks obvious private/local hosts unless **dev** + `VITE_DEBUG_MODE=true`.
- **Reachability checks** use HEAD with a timeout; failures are UX hints, not a guarantee.
- **No API keys** in the dashboard path: authenticated writes rely on cryptographic signatures acceptable to the feed’s `SignatureOrAPIKeyAuth` policy.
- **Secrets:** never commit `.env`; WalletConnect project id is optional public config embedded at build time.

---

## Deployment

- **Static hosting:** `npm run build` emits `dist/`; nginx (see `Dockerfile` + `docker/nginx.conf`) or any static CDN can serve it.
- **Docker:** Multi-stage Node build then nginx with pinned digests—see README.
- **Configuration:** Only `VITE_*` variables are available in client code (Vite).

---

## Intentionally out of scope

- Running or embedding [dp1-feed-v2](https://github.com/display-protocol/dp1-feed-v2) / PostgreSQL.
- OAuth/JWT flows (wallet signatures only here).
- Server-side persistence of drafts (except browser `localStorage` list metadata).

---

## Further reading

- [DEVELOPMENT.md](../DEVELOPMENT.md) (tooling and workflow)
- [TypeScript conventions](typescript_coding_standards.md)
- **[dp1-feed-v2](https://github.com/display-protocol/dp1-feed-v2)** canonical docs: [`docs/architecture.md`](https://github.com/display-protocol/dp1-feed-v2/blob/main/docs/architecture.md), [`docs/api_design.md`](https://github.com/display-protocol/dp1-feed-v2/blob/main/docs/api_design.md), [`api/openapi.yaml`](https://github.com/display-protocol/dp1-feed-v2/blob/main/api/openapi.yaml)

---

## Contributing

Prefer small changes that preserve clear boundaries (`api.ts` vs forms vs signing). Follow [DEVELOPMENT.md](../DEVELOPMENT.md).
