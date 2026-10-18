# B03 Luna, conversational MVP: implementation plan

Spec: `docs/product/ai/HALO_BACKEND_WORKING_SPEC.md` on `origin/codex/october15-review-refinement`, sha256 `fc1fec4b180dc5057b2edf1c2203143d85535b43364502e674d34e04d415be86`, 521,027 bytes. Primary requirements: **BE-351** (server-enforced capability flag), **BE-199** and **BE-201** (validation and safe envelopes), **BE-197** (operation ledger), **BE-230** (ownership), plus the X01/X02 Luna feature rows. Release gates: none closed by this package.

Branch: `vmag211/backend`. Decision this package implements: **Vibhav, 2026-10-18, Option A.** Luna answers and cites. Luna does not act.

## The scope decision, and why it is the whole plan

Luna's registry surface is ten operations. Five of them are the tool half: `proposals/edit`, `proposals/cancel`, `tools/confirm`, `operations`, and the proposal fields inside `messages`. That half carries revision-bound mutation proposals, confirmation, authorization and durable operation status, and it is where nearly all of Luna's risk and effort live.

This package builds the answering half and reports the tool half as unavailable through the contract's own capability mechanism. Five endpoints, no mutations, no new privacy decision.

**Out of scope, explicitly:** every tool and proposal operation; Luna writing or changing any record; Luna reading household data (see Ruling L2); streaming; and the frontend work to render an answer, which is Yogi's.

## Executable contracts (these outrank this prose)

`.superpowers/sdd/b03-luna-conversational-mvp/luna-contract-digest.md` is the cited digest of the frontend's Luna types, validators and caller behaviour, with a file:line citation per claim. Where it quotes the frontend, it is binding. Where it says "ambiguous", the controller rules before an implementer proceeds.

Question 8 of that digest is load-bearing for this entire package: the exact mechanism by which `luna.capabilities` reports that tools are unavailable **without the UI appearing broken**. If no such mechanism exists in the contract, this plan's shape is wrong and the controller must re-scope before Task 2 starts.

## Rulings made before execution

- **Ruling L1, free models are the target, not a fallback.** Inference runs on OpenRouter's free tier through the existing `ASSISTANT_*` configuration: `ASSISTANT_EMBED_MODEL`, `ASSISTANT_CHAT_MODEL` and the `ASSISTANT_CHAT_FALLBACK_MODELS` list that lets a rate-limited free model fall through to the next. Cost if wrong: none to correctness; a paid model can be configured later by changing an environment variable. **Note the hazard:** `lib/assistantRag.js:24-25` defaults to `text-embedding-3-small` and `gpt-4o-mini`, which are paid OpenAI models, when the variables are unset. Task 1 must make an unset model variable fail loudly rather than silently selecting a paid default.
- **Ruling L2, Luna sees no household data in this package.** `app/api/assistant/route.js:143` sends household context only when `ASSISTANT_SEND_HOUSEHOLD_CONTEXT` is exactly `'true'`, fail-safe since `bae920c`, and the open decision on whether household readings and symptom names may reach a free-tier model is Vibhav's and is unresolved. Luna therefore answers from the public corpus only and must report `uses_household_data: false` or the contract's equivalent. Cost if wrong: Luna cannot answer "how was my air quality last week" in this release, which is a real capability gap and must be stated in the capability response rather than hidden.
- **Ruling L3, history is bounded at the server.** A conversation re-sends context every turn, so unbounded history is how a free-tier Luna dies mid-demo: per-minute token limits bite long before the daily request cap. The server owns the bound and enforces it regardless of what a client sends. Cost if wrong: a long conversation loses its earliest turns, which is the correct trade against failing outright.
- **Ruling L4, generation failure degrades to retrieval.** When the chat model is unavailable, rate-limited or returns nothing usable, the route returns the retrieved cited passages without generated prose, clearly marked as such. The person still gets a real sourced answer for the cost of one embedding call. A model outage must not become a broken feature. Cost if wrong: a plainer answer than intended; the alternative is an error where an answer was possible.
- **Ruling L5, the capability ships behind a server-enforced flag, default off** (BE-351), the same mechanism `lib/features.js` already provides for recovery. Nothing is reachable until it is turned on deliberately.
- **Ruling L6, the legacy assistant stays.** `/api/assistant` keeps working and is not migrated, rewritten or deprecated by this package. Luna is additive. Cost if wrong: two answering paths exist at once, which is acceptable while Luna is flag-gated and is cheaper than a migration nobody asked for.

## Global constraints (every task, every reviewer)

Everything in the B01 and B02 plans' "Global constraints" still applies unchanged: identity only from the verified token, additive responses, no app-facing em dashes, server-side schema validation on every mutation, no secrets or provider payloads in responses, logs or error envelopes, idempotent migrations that degrade cleanly, `node --test` only, the full gate before every commit, conventional commits with **no `Co-Authored-By` and no Claude attribution**, scope discipline, and the truthfulness rules. Additions for this package:

- **No medical interpretation.** The legacy assistant declines diagnosis and treatment and survived ten adversarial questions on production. Luna inherits that standard; any refusal behaviour weaker than the existing one is a defect, not a difference.
- **Citations or an honest absence.** An answer either carries the passages it rests on or says it has no source. A generated answer with no retrievable source must not be presented as sourced.
- **Prompt injection is expected, not hypothetical.** Corpus passages are trusted content; a user turn is not. A user turn must never be able to change Luna's instructions, its refusal behaviour, or what it discloses.
- **Every quota is enforced server-side**, and running out produces the calm limit message the existing assistant already uses, never an error.

## Tasks

Tasks 2a, 2b and 2c are independent and run **in parallel, each in its own git worktree**, because each adds its own routes and its own declarations and touches no file another needs. Task 1 must land first because all three consume it; Task 3 must land last because it consumes all of them.

### Task 1: foundation (sequential, blocks everything)

Migration `0020_luna_conversations.sql` and `lib/luna.js`.

- Conversation and turn storage, owner-scoped and cascading like every other owned table, declared in the guardrail files the repo requires (`test/helpers/tables.mjs`, `rlsIsolation.test.mjs`, `isolationSeed.mjs`, the privacy inventory). Service-role only with no client policy, following 0017 and 0018.
- The run model: how a long answer is represented, how it settles, how it is cancelled, read from the digest's section 5.
- Bounded history (Ruling L3), as a pure function with its own tests, so the bound is provable without a model.
- Retrieval reuse: wrap the existing `lib/assistantRag.js` rather than reimplementing it, and make an unset model variable fail loudly (Ruling L1).
- Apply steps and a tested back-out block in `YOUR_TODO.md`, with the `<!-- backout-0020 -->` marker and a test in `test/migrationBackout.test.mjs`.
- Privacy inventory rows, including the retention question for stored conversation turns, which is undecided and must be recorded as undecided rather than invented.

### Task 2a: `POST /api/luna/messages` (parallel)

The answering route: validate, bound history, retrieve, generate, cite, store the turn, return the contract's shape. Degrade to retrieval on generation failure (Ruling L4). Per-user, per-conversation and app-wide quotas enforced server-side. Refusal behaviour at least as strong as the legacy assistant's, with adversarial tests including prompt injection, attempted instruction override, diagnosis and treatment requests, and a question with no source in the corpus.

### Task 2b: `GET /api/luna/conversations` and `POST /api/luna/conversations/clear` (parallel)

List the caller's conversations; clear them. Clearing is a mutation, so it goes through the operation ledger with domain `luna` and must be idempotent on replay. A cleared conversation must leave unrelated records untouched, proved by test. Cross-household isolation on both.

### Task 2c: `GET /api/luna/capabilities`, `GET /api/luna/runs/status`, `POST /api/luna/runs/cancel` (parallel)

`capabilities` is the task that makes this package honest: it must report, in the contract's own vocabulary, that answering is available and that tools and proposals are not, without the UI appearing broken. Build it from the digest's question 8. `runs/status` and `runs/cancel` operate the run model from Task 1; cancelling is a mutation and goes through the ledger.

### Task 3: integration, contracts and checkpoint (sequential, last)

Merge the three worktrees, resolve the declaration collisions (each parallel task adds its own line to the same `ROUTE_COVERAGE` map, so expect a textual conflict there and nowhere else), then extend `docs/backend/contracts/` with the Luna operations and synthetic fixtures, conformance-test the real handlers through the isolated harness against the frontend validators, update `requirements-tracker.md`, and write the B03 checkpoint.

## Blockers and open questions (tracked, not worked around)

1. **The household-data decision** (Ruling L2) is Vibhav's and is unresolved. It does not block this package; it blocks Luna answering from the household's own records, which is a later package.
2. **Retention for stored conversation turns** is undecided, like every other retention period in `privacy-and-retention.md`. A conversation is free text a person typed, so this is more sensitive than most of the open periods, and Task 1 records it as undecided.
3. **Free-tier concurrency.** The existing ceiling is 450 questions a day app-wide at roughly two requests each, sized against OpenRouter's free tier. A conversation costs more per answer than a single question, so the same ceiling buys fewer conversations. The number is a product decision disguised as a configuration value and Vibhav should set it deliberately before any demo.
4. **Model ids must be pinned in the deployment.** An unset `ASSISTANT_CHAT_MODEL` or `ASSISTANT_EMBED_MODEL` currently selects a paid OpenAI default. Task 1 makes that fail loudly, but the deployment should still set both explicitly.
