### Review priority

1. Correctness and data integrity vs **feed + DP-1 semantics** (POST/PATCH merges, signatures)
2. Security posture in the browser (**URIs**, dev-only escapes, **`VITE_*`** exposure)
3. Architecture and module boundaries (**`components`** vs **`lib/api.ts`** vs **`signing.ts`**)
4. Feed HTTP contract clarity (errors, payloads, versioning)
5. Test and documentation sufficiency

### Required expanded review posture

- Do not review only for local diff correctness.
- Infer intended product/outcome from the branch and UX, then judge whether implementation matches that safely.
- Do not default to minimal-change bias when deletion or refactor is clearly better aligned with **`docs/architecture.md`**.
- Prefer findings about behavior, security, brittle async flows (wallet, queries), weak typing at edges, or contract drift over stylistic nits.
- Do not speculate: raise concrete, actionable items only.

### TypeScript / React review focus

- Types are coherent at **`FeedAPIError`** boundaries and DP-1 JSON edges; unjustified **`any`/casts are suspect.
- Side effects localized; hooks do not bury fetch/signing spaghetti without strong reason.
- **React** correctness: staleness hazards on edits; keys/query invalidation behave when switching entities.
- Comments preserve non-obvious intent (canonicalization rules, PATCH merge strategy, extensions fallbacks).
- No secrets or non-public keys in **`VITE_`** embeddings; widening URI allowances without rationale is flagged.

### Hindsight and refactor review

After implementation, pause and ask whether deleting complexity, simplifying a module boundary, narrowing props/hooks APIs, or moving IO behind smaller helpers serves the outcome better—include this section **only when** clearly valuable.

### Tests and docs sufficiency review

Assess real gaps:

1. Are pure **`src/lib`** behaviors covered when automated tests exist?
2. Would a behavior change confuse maintainers absent updates to **`docs/architecture.md`** / **`typescript_coding_standards.md`** comments?
3. Are failure paths surfaced to users/operators?

### Preferred review output shape

Use sections only when substantive:

1. Critical correctness issues
2. Security or trust-boundary issues
3. Architecture or feed-contract issues
4. Better alternative designs (optional)
5. Test gaps (optional)
6. Documentation gaps

If there are no meaningful findings, keep the review brief.

### Verdict

End your review with exactly one line:

- `Verdict: accept`
- `Verdict: revise`
