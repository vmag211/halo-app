# Fix the AI features (2026-10-20)

Vibhav: "I updated the halo assistant api key from openrouter with 5 dollars of credits. Use that and fix
all of the AI related features in the app that are bugging." Scope: `lib/assistant*.js`, `lib/luna.js`,
`app/api/assistant`, `app/api/luna/*`, and the frontend that consumes them. Option A stands (Luna answers
and cites, never acts); household context stays off.

## What the live check found (OpenRouter, the real key, about 35 small calls, under $0.001 spent)

| Path | Result |
| --- | --- |
| Key | valid, paid (not free tier), $5 limit |
| Embedding model | listed, free, answers in about 0.2 to 1 s, 2048 dimensions = `ASSISTANT_EMBED_DIM` = migration 0013's column |
| Configured chat model (free NVIDIA) | **404 from the upstream provider every time** (endpoint gone) |
| Fallback 1 (free Google) | **429, rate-limited upstream** |
| Fallback 2 | **not in the OpenRouter catalog any more** |
| Bad model id | 400, handled (route degrades) |
| Paid `openai/gpt-4.1-nano` | cited answer in about 1 s, about $0.00007 per answer |
| Paid `google/gemini-2.5-flash-lite`, `meta-llama/llama-3.3-70b-instruct` | both cite correctly; the `models` fallback list rescues a dead primary |

So every Luna answer degraded to "I could not write an answer just now" (sources only), and every
`/api/assistant` answer was "I couldn't reach my sources". That is configuration, fixed by Vibhav's env
vars (below). The code bugs found on the way, all fixed with network-free tests:

1. **Silent degradation.** Luna's sources-only fallback logged nothing, so a dead chat model was invisible.
   Now `answerFromCorpus` returns the failure's shape (`status 404`, `empty reply`, `deadline`) and the
   messages route logs one line with that shape only (`lib/luna.js`, `app/api/luna/messages/route.js`).
2. **Follow-ups never retrieved.** "What about PFHxS?" was embedded alone and scored 0.23 against a 0.25
   floor, so Luna declined the follow-ups its bounded history exists for. Retrieval now searches with the
   previous person turn plus the new question (`retrievalQuery`); the model is still asked the new
   question only. Live: 0.58 after the fix, answered and cited. An off-topic follow-up still declines (0.18).
3. **Em dashes on screen.** The ingested corpus labels and passages contain U+2014 ("EPA — ..."), and they
   reached Luna's source titles and evidence blocks; the legacy `DIAGNOSTIC_REFUSAL` had one too. The
   server now removes them the way the client does (`noEmDash`), for model prose, titles, evidence and
   citation labels.
4. **Empty reply read as "no reliable source".** A model returning nothing (token budget, filtering) was
   told to the person as an absence of sources. It is now a failed answer: Luna gives the sources,
   `/api/assistant` gives its retryable "try again".
5. **No answer budget.** Requests carried no `max_tokens`, which a paid key bills (or OpenRouter refuses
   with 402 on a small balance). Now 600 by default (`ASSISTANT_CHAT_MAX_TOKENS`, clamped 64 to 4000).
6. **No deadline on `/api/assistant`.** A hung provider held the request until the platform killed it.
   One 30 s deadline now covers the whole answer, inside the client's 60 s.
7. **Capabilities and messages disagreed.** `GET /api/luna/capabilities` said `available: true` with a key
   but no model ids, while `POST /api/luna/messages` answered 503 to every question. Both now need the key
   and both model ids.
8. **Privacy line unconfirmed.** The assistant panel reads `sends_household_context` from
   `GET /api/assistant`; the route never sent it, so the panel said the service "has not confirmed its
   sharing setting". It now reports the same boolean POST decides with.
9. **Defaults that could not work.** Unset, `ASSISTANT_EMBED_DIM` meant 1536 (every 2048-wide embedding
   refused) and `ASSISTANT_MIN_SIMILARITY` meant 0.4 (tuned for a different model; declined "What is a
   radon zone?"). Defaults are now 2048 and 0.25. `scripts/ingest-corpus.mjs` no longer defaults to a paid
   OpenAI embedding model at 1536 dimensions.

## Proposed, Vibhav to confirm

- **Paid chat models.** Primary `openai/gpt-4.1-nano`, fallbacks `google/gemini-2.5-flash-lite` and
  `meta-llama/llama-3.3-70b-instruct`. At the 450-question daily cap that is at most about $0.03 to $0.05 a
  day. This replaces "ordinary Luna questions stay on the free tier" (STATE decision 2); household context
  stays off regardless.
- **Embedding stays on the free model**, because changing it means re-ingesting the corpus. Risk: with
  under $10 of purchased credit, OpenRouter limits free-model requests per day (50 at the time of
  writing), and every question costs one embedding. If questions start failing with "Luna could not
  finish that answer", either top the credit up to $10 or move to a paid embedding model and re-ingest.

## Not changed

Streaming (the client polls a run; nothing streams), `luna.proposal.*` / `luna.operation` / `luna.confirm`
(unrouted, Option A), household context (off), the free-model data-policy notice (Yogi's item).
