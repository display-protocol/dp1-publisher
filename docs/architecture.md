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
| **Publish preparation** | `src/lib/preparePublish.ts` | **Single chokepoint** for the `raw document → signed bytes + wire body` pipeline. Merges with base (edit), strips extensions when off (playlist), ensures the connected wallet is declared as signer (`curators[]` for playlist, `curator` for playlist group, `publisher.key` for channel), validates, then canonicalizes once via `*UnsignedPayloadForSigning` and derives the wire body from that canonical form. **Invariant:** CREATE wire body equals signed bytes; PATCH wire body equals signed bytes minus `id` and `created` (the only documented PATCH omissions). |
| **Published registry (local)** | `src/components/PublishedView.tsx`, `src/lib/publishedStorage.ts` | Per-wallet list metadata in `localStorage`; edits always refetch via GET—never PATCH from stale cache alone. |
| **Feed HTTP client** | `src/lib/api.ts` | Base URL helpers, GET metadata, POST create, PATCH update, GET list/detail, playlist URI helpers. Throws `FeedAPIError` with status + stable `error` code when present. |
| **Indexer GraphQL client** | `src/lib/indexerApi.ts`, `src/lib/indexerToPlaylistItem.ts` | ff-indexer-v2 GraphQL (`VITE_INDEXER_BASE_URL` + `/graphql`). Resolves releases by vendor slug across four vendors (`feralfile`, `artblocks`, `fxhash`, `objkt`) and fetches tokens using sparse `mint_numbers` lists (batched at 50/request). Also calls `triggerReleaseIndexing` mutation when the curator requests gap-filling — this is a browser-originated write, not a read-only path. Tokens are expanded into `PlaylistItem` leaves at compose time; no live indexer calls at play time. |
| **Series expand UI** | `src/components/SeriesExpander.tsx` | Curator panel inside `PlaylistForm`. Accepts a vendor slug and optional mint spec; loads tokens from the indexer, detects gaps (mint numbers present in spec but absent in index), and offers an "Index missing tokens" flow: Phase 1 polls `jobStatus` until enqueuing completes, Phase 2 polls token appearance until gaps close or timeout. Replaces the playlist item list on completion. |
| **DP-1 signing** | `src/lib/signing.ts`, `*SignPayload.ts` | Strip signatures, JCS canonicalize (RFC 8785), newline-terminated signing bytes, SHA-256 digest, EIP-191 personal sign via wagmi wallet client; build `kid` (`did:pkh:…`). `*UnsignedPayloadForSigning` whitelists typed top-level fields so unknown imported-JSON keys can't survive into hashed bytes (the feed reconstructs a typed struct that drops them). All three builders (playlist, channel, group) also **default the slug** via `generateSlug`/`generate*Slug` (`slugify(title)-id[:8]`, collision-resistant in the feed's global slug namespace) when the document lacks one — idempotent for a document that already carries a slug, so edits keep their URL. This is the only place the paste path (which never runs the form's slug step) gets a slug. |
| **Signer-identity helpers** | `src/lib/dp1WalletSigner.ts` | `ensurePlaylistWalletCurator` / `ensurePlaylistGroupWalletCurator` / `ensureChannelWalletPublisher`: declare the connected wallet as a signer on a document before signing, defensively normalizing malformed entities from the JSON boundary. |
| **Field validation** | `src/lib/channelValidation.ts`, `src/lib/playlistGroupValidation.ts`, inline playlist gate in `preparePublish.ts` | Defensive checks that run before signing on both Form-tab and JSON-tab paths. |
| **Overwrite authorization** | `src/lib/overwriteAuth.ts` | Client-side gate that decides whether the connected wallet may silently overwrite a previously-published document during the create-time auto-overwrite path (see Data flow). Authorizes by **prior role signature** on the fetched feed document, not by the document's authored `publisher.key` / `curators[]` (which can be authored arbitrarily and are mutated by the publish pipeline). |
| **Merge helpers** | `src/lib/dp1Merge.ts`, `dp1EntityWire.ts` | Server-aligned partial document shapes before PATCH/sign. |
| **Extension policy** | `src/context/Dp1ExtensionsContext.tsx`, `src/lib/dp1ExtensionPolicy.ts` | Effective `extensionsEnabled` from env override or `GET /api/v1`; gates Channel UI and playlist extension fields. |
| **Types** | `src/types/dp1.ts` | Shared shapes aligned with DP-1 / feed JSON. |

---

## Data flow (publish)

1. The form resolves a **raw document** from form state (Form tab) or parsed imported JSON (JSON tab).
2. **Create-time overwrite detection** (create publishes only; skipped for explicit edits):
   - `GET` the document's id against the feed.
   - **404** → take the normal POST path.
   - **Resolves** → the id is already on the feed. Run the **overwrite-authorization gate** (`overwriteAuth.ts`): the connected wallet's DID:PKH must appear as the `kid` of a prior **role signature** on the fetched document (`curator` for playlist / playlist group, `publisher` for channel). If the gate refuses, abort with the friendly "different wallet" error — no signing, no PATCH. If the gate passes, the publish is rerouted to **PATCH**, using the fetched feed document as `preparePublish`'s `base`.
   - The gate authorizes by *prior signature only*, not by authored signer fields. Authored `publisher.key` / `curators[]` would be a weaker check because `preparePublish` rewrites those to match the connected wallet before signing — using them to authorize would let any wallet sign an identity-rewritten payload for any id.
3. `preparePublish.ts` runs the pipeline:
   - merge with base (edit, or auto-overwrite from step 2) or pass through,
   - strip extension fields when extensions are off (playlist),
   - ensure the connected wallet is declared as the signer (`curators[]` for playlist, `curator` for playlist group, `publisher.key` for channel),
   - validate field rules,
   - canonicalize **once** via `*UnsignedPayloadForSigning` — the single source of truth for the bytes the feed will hash. The canonicalizer whitelists typed top-level fields, so unknown imported-JSON keys are dropped at this boundary.
4. The form receives `{ signedPayload, signedBytes, wireBody, toasts }`. It passes `signedBytes` directly to `signDocument` and POSTs/PATCHes `{ ...wireBody, signatures }`. **A "create" publish may go out as PATCH** when step 2 detected an existing document — the form's catch classifies failures with `attemptedUpdate` so wrong-wallet errors during overwrite show the update-mode message.
5. The completed document is sent with `POST /api/v1/...` or `PATCH /api/v1/.../{id}` as implemented in `api.ts`.
6. The feed validates, may add feed-operator signatures, persists, and returns the stored document.

**Invariant** (enforced by `preparePublish.ts`, tested in `preparePublish.test.ts`):
- **CREATE**: `wireBody === signedBytes` — the POST body equals the bytes that were hashed, so the feed verifies the signature against exactly what we sent.
- **PATCH**: `wireBody === signedBytes` minus `{ id, created }`. `id` is in the URL path; `created` is immutable. These are the only intentional omissions.

`wireBody` is derived from `signedBytes` directly (not built in parallel) — drift between them is structurally impossible at this layer.

**PATCH:** signatures must verify against the **merged** stored document overlaid with patch fields — the app refetches GET before merging for edit flows (see `publishedStorage.ts` comments). The create-time auto-overwrite path uses the same merge-with-base mechanism, so the same invariant holds.

---

## Dependencies on the feed

- **Base URL:** `VITE_FEED_BASE_URL` at build/dev time (see `.env.example`). Default fallback in code is production Feral File feed unless overridden.
- **Extensions:** Channel routes and playlist extension-dependent UI align with **`GET /api/v1`** (`extensionsEnabled`) unless **`VITE_DP1_EXTENSIONS_ENABLED`** forces on/off locally.
- **Contract:** HTTP paths, payloads, errors, ETag semantics, and pagination are defined by **[dp1-feed-v2](https://github.com/display-protocol/dp1-feed-v2)** ([OpenAPI](https://github.com/display-protocol/dp1-feed-v2/blob/main/api/openapi.yaml), [API design](https://github.com/display-protocol/dp1-feed-v2/blob/main/docs/api_design.md)). This app implements a **subset** of calls needed for dashboard workflows; treat that repository as normative.

## Dependencies on ff-indexer-v2 (series expand)

- **Base URL:** `VITE_INDEXER_BASE_URL` at build/dev time (see `.env.example`). Default fallback is `https://indexer.feralfile.com`; GraphQL endpoint is `<base>/graphql`.
- **Usage:** Primarily compose-time — resolve releases by vendor slug and fetch mint-ordered tokens; expanded items are signed into the playlist. Also browser-side **write**: calls `Mutation.triggerReleaseIndexing` when curators request gap-filling; this is an explicit curator action, not automatic.
- **Vendor support:** `feralfile`, `artblocks`, `fxhash`, `objkt`. Releases are looked up by `vendor_release_slug`; for objkt the slug equals the KT1 contract address.
- **Mint filter:** Uses sparse `mint_numbers: [Int!]` (max 50/request). The old `mint_from`/`mint_to` range fields are no longer used.
- **Job polling:** After triggering indexing, the UI polls `Query.jobStatus(job_id)` (Phase 1) then re-polls `Query.tokens(mint_numbers)` (Phase 2) until gaps close.
- **Contract:** GraphQL schema in **[ff-indexer-v2](https://github.com/feral-file/ff-indexer-v2)** `api/graphql/schema.graphql`.

---

## Security posture (browser)

- **Playlist URIs** in channel and playlist-group flows: validated in-browser (`validatePlaylistURI`); production allows **https://** and **ipfs://** only and blocks obvious private/local hosts unless **dev** + `VITE_DEBUG_MODE=true`. Form-tab publish requires an explicit **Check URLs** pass; the publish pipeline re-validates before signing.
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
