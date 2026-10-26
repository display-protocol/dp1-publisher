# dp1-publisher Review Delta

Apply these repository-specific checks in addition to `prompts/code-review.md`:

- Preserve feed and DP-1 semantics for POST/PATCH merges, canonicalization assumptions, and signatures.
- Treat URI allowances, development-only escapes, and `VITE_*` exposure as browser trust boundaries; never expose secrets or non-public keys.
- Keep components focused on UX orchestration and isolate HTTP/signing behavior in `src/lib/api.ts`, `src/lib/signing.ts`, and focused helpers.
- Trace wallet, edit, and query flows for stale state, incorrect keys, and missing invalidation when switching entities.
- Keep `FeedAPIError` and DP-1 JSON boundary types explicit; flag unjustified `any` or casts that weaken those boundaries.
