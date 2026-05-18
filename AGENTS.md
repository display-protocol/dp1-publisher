# AGENTS.md — DP-1 Publisher Repository Contract

This file defines repository-level constraints for coding agents. Detailed behavior lives in `.cursor/rules/` and `docs/architecture.md`.

## Repository overview

- **Project:** `dp1-publisher`
- **Purpose:** Vite + React + TypeScript SPA to compose DP-1 documents and publish them to a **DP-1 Feed** HTTP API using wallet-based (EIP-191) signing. This repo does **not** implement the feed server.
- **Stack:** React 18, Vite 6, TypeScript (strict via `tsc`), TanStack Query, wagmi/viem, Tailwind/Radix UI.

## Non-negotiables

- Prefer replacing or deleting flawed code paths over preserving unclear or weak abstractions.
- Do not preserve legacy compatibility shims or transitional behavior unless explicitly requested.
- Prefer small, focused modules and predictable data flow (`components` → `lib` → HTTP/signing boundaries).
- Keep domain-ish logic (merge helpers, URI rules, canonicalization assumptions) explicit and testable; isolate browser IO (wallet, `fetch`) at clear boundaries.
- For non-obvious logic, add comments that preserve future amendment context: intent, feed/DP-1 invariants, trade-offs, failure modes.
- Do not waste comments on obvious JSX or trivial assignments.

## Architecture and external API posture

- **Architecture:** `docs/architecture.md` is the canonical layout, boundaries, and dependency story. Update it when structure or assumptions change.
- **Feed HTTP contract:** Normative shapes and semantics live in **[dp1-feed-v2](https://github.com/display-protocol/dp1-feed-v2)** ([OpenAPI](https://github.com/display-protocol/dp1-feed-v2/blob/main/api/openapi.yaml), [API design](https://github.com/display-protocol/dp1-feed-v2/blob/main/docs/api_design.md)). This app consumes a subset of endpoints; when client behavior changes, align types/error handling/comments with that contract (and document deliberate subsets).
- **Scope:** Do not quietly expand UX contracts or signing rules beyond what `docs/architecture.md`, task scope, and the feed docs imply.
- **Gaps:** If a decision is not covered above, note the interim assumption in code or docs and call it out in review handoffs.

## TypeScript / React engineering contract

- Follow **`docs/typescript_coding_standards.md`**, ESLint (`eslint.config.js`), and **`npm run lint`**.
- Favor explicit types at boundaries (`FeedAPIError`, feed JSON); avoid unjustified `any` and loose casts.
- Keep components orchestrating UX; delegate HTTP to `src/lib/api.ts`, signing/crypto to `src/lib/signing.ts` and related payloads.
- React: hooks naming (`use*`); predictable effects/handlers for wallet + fetch flows; guard against staleness on edit flows (document invariants live in architecture and helpers).

## Spec-driven workflow (required for major work)

Before implementing a large feature, major feed-integration change, architectural refactor, or security-sensitive UX (wallet, URIs):

1. Read `PLANS.md`.
2. Read `.cursor/rules/01-master-design.mdc`.
3. Read `.cursor/rules/20-architecture.mdc`.
4. Read `.cursor/rules/21-feed-api-client.mdc`.
5. Summarize current behavior, constraints, and unresolved decisions.
6. Produce a plan before implementation.

**Canonical sequence:** `spec → design → tasks → implementation → verification`.

If work is large or vague and no decision record exists, do not jump straight to implementation.

## Required development sequence

1. Prefer small units and narrow files when adding behavior.
2. Add or update tests when tooling exists and behavior is non-trivial; until a test runner is standard, **`npm run build`** (`tsc` + bundle) remains the mandatory type gate—do not leave type errors for CI.
3. Implement production changes.
4. Run **`npm run lint`** and **`npm run build`**.
5. Run **`scripts/agent-helpers/post-implementation-checks`**.
6. Treat the task as complete only after checks pass and review expectations are met.

## Rule references

- `.cursor/rules/01-master-design.mdc`
- `.cursor/rules/10-typescript-react-coding-standards.mdc`
- `.cursor/rules/15-comment-contract.mdc`
- `.cursor/rules/20-architecture.mdc`
- `.cursor/rules/21-feed-api-client.mdc`
- `.cursor/rules/35-testing-tdd.mdc`
- `.cursor/rules/spec-driven.mdc`
- `.cursor/rules/review-workflow.mdc`

## Definition of done

A task is complete only when:

1. **`npm run lint`** and **`npm run build`** are clean (unless explicitly agreed otherwise).
2. Non-obvious intent is preserved for future agents (comments where needed).
3. Any new assumption about the feed contract or security posture is explicit.
4. The reviewer accepts the change (see Review workflow).

## Review workflow

After implementation, run a review loop until the reviewer qualifies the change. Do not commit, push, or open a PR before the reviewer says `Verdict: accept`.

1. Produce a compact handoff: goal, files changed, key decisions/trade-offs, checks run, unresolved assumptions.
2. Invoke the reviewer sub-agent with the handoff, diff, and lint/build output.
3. If the verdict is `revise`, address findings, rerun checks, and review again.
4. Only proceed to commit, push, or PR after `accept`.

## Commit message format

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `<type>(<optional-scope>): <description>`
- Types: `feat`, `fix`, `refactor`, `test`, `chore`, `docs`, `build`, `ci`, `perf`, `style`
- Use `!` for breaking changes.

## Review guidelines

The single source of truth for review posture and output format is **`prompts/code-review.md`**.
