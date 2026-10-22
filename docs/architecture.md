# Architecture

**dp1-publisher** is a single-page application (SPA) used to compose DP-1 documents and publish them to a **DP-1 Feed** HTTP API using **wallet-based (EIP-191) signatures**. It does not run a feed server itself; all durable state and validation happen on the feed.

**Design philosophy:** keep publishing flows in the browser, isolate HTTP and signing in small modules, and mirror feed semantics (especially extensions and signature rules) rather than inventing parallel behavior.

```text
Publisher (browser) ──► Feed API ──► PostgreSQL
   │  Vite/React       (DP-1 Feed server — https://github.com/display-protocol/dp1-feed-v2)
   │  wagmi + viem
   └── TanStack Query cache (in-memory; "Published" lists come from the feed)
```

---

## Responsibility boundaries

| Area | Location | Role |
| ---- | -------- | ---- |
| **Entry / shell** | `src/main.tsx`, `src/App.tsx` | Bootstrap React, wagmi chain config (Ethereum mainnet), TanStack Query, extensions provider. |
| **Layouts / screens** | `src/components/Dashboard.tsx` | Connect gate, Publish vs Published navigation, tabs for Playlist / Group / Channel when extensions permit. |
| **Review & sign page** | `src/components/ReviewAndSign.tsx`, `src/lib/reviewDocument.ts` | Standalone `#/sign` hash route (routed in `App.tsx`) for already-composed documents: paste/drop JSON → kind detection + strict validation + import normalization (`reviewDocument.ts`, mirroring the forms' JSON-tab parsers) → plain-language attestation summary (role, what the signature covers, what can change post-signing) → preflight overwrite check → the same `preparePublish` pipeline → wallet sign → POST (create) or PUT (replace). Prototype for issue #10's composition/signing split; the forms remain the composition surface. |
| **Forms & editors** | `src/components/PlaylistForm.tsx`, `ChannelForm.tsx` | Composer UI, JSON editor paths. Forms resolve a *raw document* from form state or pasted JSON, then route it through the publish-preparation boundary below — they no longer build wire JSON or run canonicalization themselves. |
| **Publish preparation** | `src/lib/preparePublish.ts` | **Single chokepoint** for the `raw document → signed bytes + wire body` pipeline. Merges with base (edit), strips extensions when off (playlist), ensures the connected wallet is declared as signer (`curators[]` for playlist, `curator` for playlist group, `publisher.key` for channel), validates, then canonicalizes once via `*UnsignedPayloadForSigning` and derives the wire body from that canonical form. **Invariant:** the wire body equals the signed bytes, on create and replace alike — nothing is omitted from what was signed. |
| **Published lists (feed-backed)** | `src/components/PublishedView.tsx`, `src/hooks/useOwnedDocuments.ts` | The wallet's playlists (`GET /api/v1/playlists?curator=<did>`) and channels (`GET /api/v1/channels?publisher=<did>`), newest first, paged by feed cursor. Also feeds the channel form's playlist picker and the post-publish `Add to: <channel>` CTAs, each with its own load-more while the feed has further pages. **Core-only feeds:** `curators` is an extension field stripped at publish, so the curator filter can never return core-mode playlists; the core Published view therefore offers *open by feed URL, ID or slug* (`src/lib/playlistReference.ts`) as the cross-browser way back to them. A feed-side owner/signer filter would close this gap. Works across browsers; nothing is persisted client-side. The feed matches the *declared* key (`curators[].key` / `publisher.key`) exactly and case-sensitively, so documents that never declared this wallet's checksummed did:pkh are not listed. Lists are display data only; edits always refetch via GET—never replace from a list row. Invalidated after every publish/replace from the dashboard. |
| **Feed HTTP client** | `src/lib/api.ts` | Base URL helpers, GET metadata, POST create, PUT replace (document plus signed intent), GET list/detail, playlist URI helpers. Throws `FeedAPIError` with status + stable `error` code when present. |
| **Vendor clients (series expand)** | `src/lib/vendors/`, `src/lib/mintSpec.ts`, `src/lib/vendorTokenToPlaylistItem.ts` | Read-only browser calls to the Feral File REST API, the Art Blocks Hasura GraphQL API and the objkt GraphQL API. `loadVendorRelease(vendor, slug, mintSpec)` resolves a release by slug and returns tokens in one common shape, sorted by mint number; `vendorTokenToPlaylistItem` turns them into `PlaylistItem` leaves with `onChain` provenance at compose time. HTTP only: no signing, no writes. Failures are `VendorAPIError` with a curator-facing message. See "Dependencies on vendor APIs" below. |
| **Series expand UI** | `src/components/SeriesExpander.tsx` | Curator panel inside `PlaylistForm`. Vendor dropdown (Feral File, Art Blocks, objkt), slug, optional mint spec (`1..100` or `1,3,5`). Loads once through `loadVendorRelease`, previews counts, reports requested mints the vendor did not return as an informational gap warning, and replaces the playlist item list on confirm. There is no indexing or polling step. |
| **DP-1 signing** | `src/lib/signing.ts`, `*SignPayload.ts` | Strip signatures, JCS canonicalize (RFC 8785), newline-terminated signing bytes, SHA-256 digest, EIP-191 personal sign via wagmi wallet client; build `kid` (`did:pkh:…`). `*UnsignedPayloadForSigning` whitelists typed top-level fields so unknown imported-JSON keys can't survive into hashed bytes (the feed decodes strictly and answers a stray key with a 400 naming it, so this is what keeps a paste publishable). Both builders (playlist, channel) also **default the slug** via `generateSlug`/`generate*Slug` (`slugify(title)-id[:8]`, collision-resistant in the feed's global slug namespace) when the document lacks one — idempotent for a document that already carries a slug, so edits keep their URL. This is the only place the paste path (which never runs the form's slug step) gets a slug. |
| **Signer-identity helpers** | `src/lib/dp1WalletSigner.ts` | `ensurePlaylistWalletCurator` / `ensureChannelWalletPublisher`: declare the connected wallet as a signer on a document before signing, defensively normalizing malformed entities from the JSON boundary. |
| **Field validation** | `src/lib/channelValidation.ts`, inline playlist gate in `preparePublish.ts` | Defensive checks that run before signing on both Form-tab and JSON-tab paths. |
| **Overwrite authorization** | `src/lib/overwriteAuth.ts` | Client-side gate that decides whether the connected wallet may silently overwrite a previously-published document during the create-time auto-overwrite path (see Data flow). Authorizes by **prior role signature** on the fetched feed document, not by the document's authored `publisher.key` / `curators[]` (which can be authored arbitrarily and are mutated by the publish pipeline). |
| **Merge helpers** | `src/lib/dp1Merge.ts`, `dp1EntityWire.ts` | Build the full replacement document from the stored one plus the user's edits, before signing. The feed merges nothing server-side. |
| **Extension policy** | `src/context/Dp1ExtensionsContext.tsx`, `src/lib/dp1ExtensionPolicy.ts` | Effective `extensionsEnabled` from env override or `GET /api/v1`; gates Channel UI and playlist extension fields. |
| **Types** | `src/types/dp1.ts` | Shared shapes aligned with DP-1 / feed JSON. |

---

## Data flow (publish)

1. The form resolves a **raw document** from form state (Form tab) or parsed imported JSON (JSON tab).
2. **Create-time overwrite detection** (create publishes only; skipped for explicit edits):
   - `GET` the document's id against the feed.
   - **404** → take the normal POST path.
   - **Resolves** → the id is already on the feed. Run the **overwrite-authorization gate** (`overwriteAuth.ts`): the connected wallet's DID:PKH must appear as the `kid` of a prior **role signature** on the fetched document (`curator` for playlist / playlist group, `publisher` for channel). If the gate refuses, abort with the friendly "different wallet" error — no signing, no write. If the gate passes, the publish is rerouted to a **replace**, using the fetched feed document as `preparePublish`'s `base`.
   - The gate authorizes by *prior signature only*, not by authored signer fields. Authored `publisher.key` / `curators[]` would be a weaker check because `preparePublish` rewrites those to match the connected wallet before signing — using them to authorize would let any wallet sign an identity-rewritten payload for any id.
3. `preparePublish.ts` runs the pipeline:
   - merge with base (edit, or auto-overwrite from step 2) or pass through,
   - strip extension fields when extensions are off (playlist),
   - ensure the connected wallet is declared as the signer (`curators[]` for playlist, `curator` for playlist group, `publisher.key` for channel),
   - validate field rules,
   - canonicalize **once** via `*UnsignedPayloadForSigning` — the single source of truth for the bytes the feed will hash. The canonicalizer whitelists typed top-level fields, so unknown imported-JSON keys are dropped at this boundary.
4. The form receives `{ signedPayload, signedBytes, wireBody, toasts }`. It passes `signedBytes` directly to `signDocument` and sends `{ ...wireBody, signatures }`. **A "create" publish may go out as a replace** when step 2 detected an existing document — the form's catch classifies failures with `attemptedUpdate` so wrong-wallet errors during overwrite show the update-mode message.
5. The completed document is sent with `POST /api/v1/...` for a create, or `PUT /api/v1/.../{id}` for a replace, as implemented in `api.ts`. A replace sends `{ document, authorization }`: the document plus a **signed mutation-intent** built by `replaceIntent.ts`, naming the target and carrying the document's `payloadHash` and a fresh `created`. The intent is required because a document's own signatures are public and replayable, and its `created` is inside its own signed payload — a signature's `ts` is not covered by the signature and cannot bound replay.
6. The feed validates, may add feed-operator signatures, persists, and returns the stored document.

**Invariant** (enforced by `preparePublish.ts`, tested in `preparePublish.test.ts`):
- **CREATE and REPLACE alike**: `wireBody === signedBytes` — the body equals the bytes that were hashed, so the feed verifies the signature against exactly what we sent.
- Replace used to omit `{ id, created }`, which suited PATCH. Under PUT that is wrong twice: the feed validates the submitted `id`, `slug` and `created` against the stored resource, and both fields are inside the signed payload, so omitting them would leave the delivered bytes different from the signed ones.

`wireBody` is derived from `signedBytes` directly (not built in parallel) — drift between them is structurally impossible at this layer.

**Replace:** signatures must verify against the **merged** stored document overlaid with the user's edits — the app refetches GET before merging for edit flows (see `useOwnedDocuments.ts` comments). The create-time auto-overwrite path uses the same merge-with-base mechanism, so the same invariant holds.

---

## Dependencies on the feed

- **Base URL:** `VITE_FEED_BASE_URL` at build/dev time (see `.env.example`). Default fallback in code is production Feral File feed unless overridden.
- **Extensions:** Channel routes and playlist extension-dependent UI align with **`GET /api/v1`** (`extensionsEnabled`) unless **`VITE_DP1_EXTENSIONS_ENABLED`** forces on/off locally.
- **Contract:** HTTP paths, payloads, errors, ETag semantics, and pagination are defined by **[dp1-feed-v2](https://github.com/display-protocol/dp1-feed-v2)** ([OpenAPI](https://github.com/display-protocol/dp1-feed-v2/blob/main/api/openapi.yaml), [API design](https://github.com/display-protocol/dp1-feed-v2/blob/main/docs/api_design.md)). This app implements a **subset** of calls needed for dashboard workflows; treat that repository as normative.
- **The feed verifies and stores the bytes it is sent.** dp1-feed-v2 decodes a submission strictly against its request models, which embed dp1-go's document structs (`internal/httpserver/bind.go`): a member those models do not declare is a 400 naming the field, never a silent drop. It then verifies every signature over the exact bytes received (dp1-go `sign` strips only the signature members, through a generic map, before JCS) and stores those bytes verbatim; nothing is rebuilt from decoded fields. Two consequences for the canonicalizer: a field we emit that the feed's dp1-go does not know fails the publish loudly, and a field we drop that the feed would accept is silently lost metadata (#25). So **the whitelist tracks the feed's dp1-go version, not the spec's** — when the feed bumps dp1-go, `playlistSignPayload.ts` is the first thing to re-check. The `omitempty` mirroring in the same file is not needed for verification any more; it keeps the published shape one that Go's own marshal produces, so typed tooling can reproduce the signed bytes from the decoded document.
- **Item-level `inlineManifest`** (playlists extension §3.6) is carried through to the signed bytes as-is; the feed has supported it since its dp1-go v0.6.0 bump. Verified against dp1-go v0.6.0 directly, when the feed still re-marshalled before verifying: for a playlist whose item carries an inline manifest, our canonical signing bytes matched Go's bind → re-marshal → JCS output byte for byte. With extensions on the feed validates the manifest against the unmodified ref-manifest schema and returns 400 on a malformed one; with extensions off the core schema does not describe the field, so `preparePublish` strips it before signing rather than letting it through unchecked.
- **Item-level `contentRating` / `contentReasons`** (Content Rating Extension v0.1.0, display-protocol/dp1 `extensions/content-rating`) are carried verbatim into the signed bytes in both extension modes. The feed accepts them once its dp1-go declares them — `PlaylistItem` gained both in dp1-go v0.6.2; a feed still on v0.6.1 refuses the item with a 400 naming the field, which is the intended failure (loud, at publish time) rather than a `mature` work published unlabelled (dp1-publisher#25). `preparePublish` gates their shape (string rating, array of non-empty reasons) before the wallet prompt regardless of what the feed validates; the vocabulary stays open.

## Dependencies on vendor APIs (series expand)

"Load from series" reads releases straight from each vendor's public API in the browser. It replaced the ff-indexer-v2 GraphQL path (feral-file/feral-file#3576): nothing is indexed on the fly, and a requested mint the vendor does not list is shown to the curator as a gap rather than queued for indexing. fxhash is no longer supported. The old indexer client (`src/lib/indexerApi.ts`, `src/lib/indexerToPlaylistItem.ts`) is deprecated, not deleted: it stays in the tree with its tests until ff-indexer-v2 is retired, no app code imports it (an ESLint `no-restricted-imports` rule enforces this), and `VITE_INDEXER_BASE_URL` is read only by that unused module.

| Vendor | Endpoint | Slug | Mint number | Item source |
| ------ | -------- | ---- | ----------- | ----------- |
| Feral File | `GET https://feralfile.com/api` `/series?slug=`, `/artworks?seriesID=&sortBy=index` | series slug | artwork `index + 1` | `previewURI` on the artwork CDN |
| Art Blocks | `POST https://artblocks-mainnet.hasura.app/v1/graphql` `projects_metadata`, `tokens_metadata` | project slug, Ethereum mainnet only | `invocation + 1` | `live_view_url`, else `preview_asset_url` |
| objkt | `POST https://data.objkt.com/v3/graphql` `fa`, `token` | KT1 contract address | `Number(token_id)` | `artifact_uri`, else `display_uri`, IPFS through a gateway |

- **Auth and CORS:** none of the three needs a key. Art Blocks and objkt allow any origin. Feral File answers 403 to an `Origin` it has not allow-listed: `publisher.feralfile.com` is allowed, so production calls it directly, while `npm run dev` goes through the Vite proxy at `/ff-api`, which strips `Origin` (`vite.config.ts`). `VITE_FERALFILE_API_BASE_URL` overrides the base; a publisher served from another origin needs either that origin allow-listed or a same-origin proxy.
- **Request budget:** loaders issue requests sequentially. Art Blocks rate-limits at a few requests per second and objkt is shared infrastructure. A load-all stops at `LOAD_ALL_CAP` (1000, equal to the mint-spec maximum) and reports `wasCapped` when the vendor holds more. Page sizes: Feral File 100, Art Blocks 500, objkt 500 (a server cap that silently truncates larger limits).
- **Mint specs:** Art Blocks filters with `invocation _in`, objkt with `token_id _in` (strings). Feral File has no index filter, so the loader fetches one page starting at each cluster of requested mints (relying on offset = 0-based index under `sortBy=index`), bounded to 10 pages. Mints left unvisited are reported as "not checked", never as "not found".
- **Request timeout:** each request aborts after 20 seconds with a curator-facing error, since the panel is locked while a load runs.
- **Ordering:** results are sorted client-side by mint number and deduplicated by contract and token id. objkt's `token_id` is a string column, so its server order is lexicographic and is never trusted.
- **Skips and moderation:** Feral File artworks with no index, no contract or token id, or chain `bitmark` (not yet swapped on-chain) are skipped, as the indexer did. objkt is restricted to `collection_type: custom` contracts; shared contracts such as hic et nunc are refused with an error. objkt tokens flagged `banned` or `removed` are kept in the result, so they do not count as gaps, but never become items. No other vendor exposes a takedown signal, so nothing else is filtered (Art Blocks `is_flagged` is not a takedown flag).
- **Normalization:** EVM contract addresses are EIP-55 checksummed regardless of vendor. Feral File media follows the indexer's rules: a relative URI lives on `https://cdn.artworks.feralfile.io/`, the retired `cdn.feralfileassets.com` host is rewritten everywhere in the URL, a directory path gains `index.html`, and a Cloudflare Images URL without a variant gets `/xl`. objkt `ipfs://` media is resolved through `VITE_IPFS_GATEWAY_BASE_URL` (default `https://ipfs.filebase.io/ipfs`). Any source still not https after normalization (`data:`, `ar:`, `onchfs:`, `http:`) is dropped and the token counts as skipped, so every series source is https and a series never blocks publish at the URI gate.
- **Deliberate differences from the indexer output:** Feral File sources are always the CDN preview, where the indexer sometimes emitted an on-chain `ipfs://` animation URL for image series. Feral File titles follow the indexer's rule: an edition-style name ("#1", "AE", "AP", "PP") is prefixed with the series title, any other artwork name stands alone. Art Blocks titles keep the 0-based `"<project> #<invocation>"` form the indexer used.

---

## Security posture (browser)

- **Playlist item `source`**: validated in-browser (`validateItemSourceURI`) to the DP-1 core rule — `format: uri`, i.e. any **absolute URI** (https, http, ipfs, ar, file, data, …; spec §8 lists HTTP(S), IPFS and offline `file://`). The feed never fetches `source` (players do), so there is no scheme allow-list or private-host check. Only publisher-policy narrowing: `javascript:` is rejected, and unencoded whitespace/control characters or malformed `%` escapes are refused rather than silently accepted or re-encoded. Form-tab sources are trimmed in `itemsForPlaylistExport`, so the signed value is the validated one.
- **Playlist URIs** in channel flows (`playlists[]`): the feed **fetches** these at ingest, so `validatePlaylistURI` mirrors the dp1-feed-v2 fetcher — http(s) only (no `ipfs://`), a host, no embedded credentials, obvious private/local hosts blocked. Syntax (authority form `http(s)://host`, no whitespace/backslash, well-formed `%` escapes) is checked on the **raw** string, since that — not the WHATWG-normalized `URL.href` — is what gets signed and parsed by Go on the feed; JSON-tab entries are trimmed before signing, as validated. Production narrows further to **https://**; **dev** + `VITE_DEBUG_MODE=true` allows `http://` and private hosts. Form-tab publish requires an explicit **Check URLs** pass; the publish pipeline re-validates before signing.
- **No API keys** in the dashboard path: the feed removed API-key auth, so authenticated writes rely solely on the cryptographic signatures in the request body.
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
- Server-side persistence of drafts.
- Client-side registries of published documents: the feed's owner filters are the only source for "Published".

---

## Further reading

- [DEVELOPMENT.md](../DEVELOPMENT.md) (tooling and workflow)
- [TypeScript conventions](typescript_coding_standards.md)
- **[dp1-feed-v2](https://github.com/display-protocol/dp1-feed-v2)** canonical docs: [`docs/architecture.md`](https://github.com/display-protocol/dp1-feed-v2/blob/main/docs/architecture.md), [`docs/api_design.md`](https://github.com/display-protocol/dp1-feed-v2/blob/main/docs/api_design.md), [`api/openapi.yaml`](https://github.com/display-protocol/dp1-feed-v2/blob/main/api/openapi.yaml)

---

## Contributing

Prefer small changes that preserve clear boundaries (`api.ts` vs forms vs signing). Follow [DEVELOPMENT.md](../DEVELOPMENT.md).
