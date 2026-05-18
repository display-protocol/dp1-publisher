# Execution Plans

Use this document when work is large enough, risky enough, or vague enough that implementation should be preceded by explicit planning.

## When to use this

Use an execution plan when the task involves one or more of:

- new or changed integration with the **feed HTTP API** (paths, payloads, auth/signature behavior)
- architectural refactors across `src/` layers
- wallet, signing, or canonicalization changes
- security-sensitive behavior (URI allowlists, reachability checks, env flags)
- cross-cutting UI + `lib/` changes
- unclear requirements with multiple viable designs

Do not use this for small, direct edits, isolated fixes, or straightforward doc updates.

## Planning workflow

1. Summarize the current state that matters.
2. List invariants and constraints.
3. Call out unknowns, assumptions, and missing owner decisions.
4. Propose design branches when there are materially different options.
5. Define verification (lint, build, tests when present) before implementation details.
6. Recommend a staged delivery plan.

## Required plan shape

### 1. Current context

- relevant files under `src/components/`, `src/lib/`, `src/types/`, `src/context/`
- current behavior
- operational or product constraints (browser-only, `VITE_*` config)

### 2. Constraints and invariants

- correctness vs feed + DP-1 expectations
- security (URIs, no secrets in client bundle)
- compatibility with deployed feeds

### 3. Open questions

- decisions not yet locked for *this* change
- if none: state **none** and cite `docs/architecture.md` and **[dp1-feed-v2](https://github.com/display-protocol/dp1-feed-v2)** ([OpenAPI](https://github.com/display-protocol/dp1-feed-v2/blob/main/api/openapi.yaml), [API design](https://github.com/display-protocol/dp1-feed-v2/blob/main/docs/api_design.md)) instead of leaving this blank

### 4. Design options

For each viable option, include: summary, benefits, trade-offs, risks, and whether it primarily deletes, refactors, or adds code.

### 5. Verification first

- `npm run lint`, `npm run build`
- unit/component tests when the repo has a runner and the behavior warrants it
- manual or integration checks against a local feed if behavior is end-to-end

### 6. Recommended rollout

- smallest safe first increment
- follow-up increments if needed

## Decision rule

If two or more options differ materially in behavior, risk, architecture, or future maintenance burden, pause and ask the repo owner to choose.
