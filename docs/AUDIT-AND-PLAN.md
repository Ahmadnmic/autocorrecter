# Audit and plan

Written 2026-09-22, after measuring the live system. Two parts: what is there now and where it hurts, then what to
build next — including how far the system can go without Haiku, and how to fine-tune Laya for this job.

## 1. What the system is today

Four clients (web page, macOS/Windows app, Android keyboard, Android spell checker) share one API on Vercel. Every
client runs the same pipeline:

| pass | where the candidate comes from | who decides | typical latency |
|---|---|---|---|
| common typos | local table (`COMMON_TYPOS`) | nobody, applied directly | 0 ms |
| learned library + abbreviations | `/api/library`, cached in the client | nobody, applied directly | 0 ms |
| dictionary typo | Hunspell suggestions (server) | Jev `choice` + `intentional` | ~250 ms |
| confusable re-check | fixed alternative lists | Jev `choice` | batched with the above |
| context pre-filter | — | Jev `noul` | batched |
| context proposals | **Haiku generates** | Jev gate (`choice`, `prefers`, `reads`) | 1.4–2.0 s + 0.25 s |
| late resolution | **Haiku generates** | Jev gate | 1.0–1.5 s |
| sentence repair (pause) | **Haiku generates** | Jev gate (`choice`, `meaning`, `needed`) | 1.5–2.4 s |
| translation (word) | **Haiku generates** | Jev gate | ~1 s |
| translation (sentence, chosen language) | **Haiku generates** | Jev gate (`choice`, `faithful`) | 1.5–2.5 s |
| grammar/punctuation near the caret | local rules (`lib/grammar.ts`, `Grammar.kt`) | nobody | 0 ms |
| learning | cron over the event log, Haiku vets candidates | — | every 10 min |

Roughly: **Jev decides, Haiku proposes, the clients apply.** Nothing is applied that a gate did not approve, and every
applied change is revertible and logged.

### Audit list

**Correctness and behaviour**
1. Android had no automated tests at all; every regression this week was found by the user, not by a test.
2. The desktop app has replay tests (`test.js`, `test-hook.js`, `test-context.js`, `test-keymap.js`, `test-updater.js`)
   and the web has `scripts/verify-web.mjs` (runs on every deploy). Both are good; extend rather than replace.
3. The engine exists three times (TypeScript on web, JavaScript on desktop, Kotlin on Android). Every fix has to be
   made three times, and this week several bugs existed in exactly one copy (ids, offsets, foreign-word handling).
4. Sentence repair is applied on Android only. Desktop receives `rewrite` and ignores it; the web does not ask for it.
5. The spell checker (Android) shares the passes but not the code path; it has drifted twice already.

**Latency**
6. Haiku dominates every context-dependent fix: 1.4–2.4 s against 250 ms for a Jev decision.
7. The context pass now runs in parallel with the batched Jev call, and constrained JSON decoding was replaced by
   plain JSON (2.3–6 s → 1.4–2.0 s). That is close to the floor for a hosted generative call.
8. Cold serverless instances add up to 1 s on the first request after idle; `/api/warm` only partly hides it.

**Cost and dependencies**
9. Every context fix costs a Haiku call plus a Jev call. Jev is a closed API with rate limits per key tier.
10. Laya (Apache-2.0) can replace Jev for gating, self-hosted, but **not off the shelf**: measured 3–4 of 8 on this
    app's own gating questions, with uncalibrated confidences (the project's own benchmarks agree: the base
    checkpoints sit below the majority-class baseline; all capability comes from fine-tuning).

**Data and learning**
11. The learning job promotes only corrections seen twice with no reverts, vetted by Haiku. Sound, but slow to move:
    a personal profile needs two identical outcomes on one device.
12. Logs are the only training data, they are scrubbed, and retention is 14 days. Fine-tuning needs them kept longer
    (or exported) before they are pruned.

**Security and privacy** (full detail in `docs/SECURITY.md`)
13. Text near the caret goes to the server in clear over HTTPS; password/number/e-mail fields are skipped client-side.
14. Admin and cron routes are secret-gated; the propose route exposes gate internals only with the admin secret.
15. macOS builds are signed with a self-signed identity kept on one machine; losing it costs every user one re-grant.

## 2. Plan

Ordered by what the user feels, not by what is interesting.

### A. Stop regressions (do first)
- **Android instrumentation-free unit tests** for `Engine`, `Grammar` and `TextUtil` with a fake `IO`: the same
  replay style the desktop uses. Covers the four bugs found this week (ids, offsets, anchors, boundary snapshot).
- **One shared test corpus** (`tests/corpus.jsonl`): sentence in, expected changes out. Run it against the web page
  engine, the desktop engine and the Kotlin engine in CI, so the three copies cannot drift apart silently.
- Extend `verify-web.mjs` whenever a pass changes (it already caught the tone timeout and the comma regression).

### B. Make the three engines one
- Extract the decision logic (what to ask, when, with which anchors) into a small, dependency-free TypeScript core
  with a platform interface (`textBefore`, `replace`, `log`). Web and desktop use it directly.
- For Android, either keep the Kotlin port but generate its test corpus from the same file, or run the core in a
  small JS runtime. The first is cheaper; the second removes the drift entirely.

### C. Cut the wait for context fixes
- **Local candidate generation** (see §3): most context fixes do not need a model to *invent* the replacement, only
  to *choose* it. Generating candidates locally turns a 1.5 s generative call into a 250 ms decision — or 33 ms once
  Laya is self-hosted on a GPU.
- Keep Haiku for what genuinely needs generation: sentence repair, sentence translation, and open-ended proposals.
- Speculative pre-fetch: start the pre-filter on the *previous* window while the user is still typing the next word.

### D. Own the decision engine (Laya)
See §4. The service and the client switch are already built (`services/laya/`, `LAYA_URL`); only the fine-tuned
checkpoint is missing.

### E. Product
- Desktop: apply `rewrite` (sentence repair) and add the pause pass, so the Mac and Windows apps match the phone.
- Web: show the personal profile and the word list (Android has both now).
- A "what changed and why" panel: every change already carries a reason from the gate; nothing surfaces it.

## 3. How far can this go without Haiku?

Haiku is used for five things. Three of them do not need generation at all:

| use | needs generation? | replacement without Haiku |
|---|---|---|
| dictionary typo candidates | no | Hunspell already supplies them; Laya chooses |
| confusable re-check | no | fixed lists; Laya chooses |
| context pre-filter | no | `noul` question; Laya answers |
| **run-together words** ("canyouhelp") | no | dynamic-programming split over the 50k frequency list produces every legal split; Laya picks the best. This is what late resolution mostly does. |
| **agreement / tense / preposition errors** | no | generate candidates morphologically: a small inflection table per language (was/were, goes/went, don't/doesn't, og/at, nogen/nogle) plus Hunspell's own morphology. Laya picks. |
| **wrong word for the meaning** (open-ended) | sometimes | if the intended word is a neighbour in edit distance or a confusable, candidates are local; if it is an arbitrary better word, generation is needed |
| **sentence repair** (word order, missing words) | yes | keep Haiku |
| **sentence translation** | yes | keep Haiku (or a local seq2seq later) |

So the realistic target is: **every word-level fix decided by Laya on local candidates, no generative call in the hot
path**; Haiku only on a pause, for sentence repair and translation. That removes the 1.5–2 s wait from the common
case and cuts per-fix cost to zero (self-hosted), while keeping the quality ceiling where it matters.

Order of work: (1) candidate generators (split, inflection, confusable, Hunspell) behind one `candidates(word, ctx)`
function on the server; (2) route them to the existing gate; (3) measure against the current pipeline on the shared
corpus; (4) only then remove the Haiku call from the hot path.

## 4. Fine-tuning Laya for this job

**Why it is needed.** Measured on this app's real gating questions, base Laya answers 3–4 of 8 correctly
(`multilingual` 4/8, `english` 4/8, `typed-decisions` 3/8) with confidences of 0.06–0.29 where the answer is obvious.
The project documents the same: base checkpoints score 0.34–0.36 on typed decisions, the fine-tune 0.766, above Jev's
published 0.727. Fine-tuning is not an optimisation here, it is the entry ticket.

**What to fine-tune on.** `laya-multilingual` (mmBERT-base, 322M, 1024 context) — Danish and English in one
checkpoint, 2.2× faster than the English one, and Danish is where the confusables (og/at, nogen/nogle, hans/sin) live.

**Dataset** (`scripts/build-laya-dataset.mjs`, already written; format matches the project's notebook:
`{id, workflow, state, questions, gold}` JSONL):
1. **Outcomes** — every applied/kept and reverted change from the event log. Ground truth, the user's own judgement.
   *Action needed: raise log retention to 90 days or export daily, before the 14-day prune deletes the training set.*
2. **Teacher** — replay the same states through Jev and keep its answers. Distillation from the engine being
   replaced; this is what makes the set big enough (target 30k+ questions).
3. **Synthetic** — errors planted in clean sentences: typo table, confusables in and out of context, run-together
   words, agreement slips, in both languages. Labels correct by construction. Expand the clean corpus from the
   frequency lists and the user's own kept text.
4. **Negatives** — correct text that must be left alone, in the same proportion as production (most decisions are
   "keep"). Without these the model learns to always change something.

**Training.** The project's notebook (`laya_finetune_typed_decisions_2xT4_kaggle.ipynb`) does the whole loop on
Kaggle's free 2×T4: build, train with RLCD (proper-scoring-rule rewards, GRPO-style policy gradient), fit calibration
temperatures, evaluate, push to the Hub. ~4–5 hours for 4 epochs over ~30k questions. Adapt: swap the dataset for
ours, keep the four workflows as `typo`, `recheck`, `prefilter`, `gate`.

**Acceptance gates before it replaces Jev** (run on a held-out split and on `scripts/verify-web.mjs`):
- ≥ 0.85 argmax accuracy on `typo` and `recheck`, ≥ 0.80 on `gate`, at or above the current Jev behaviour on the
  shared corpus;
- ECE ≤ 0.10 after temperature fitting (the thresholds in `lib/thresholds.ts` are meaningless otherwise);
- **no regression on "keep"**: the false-change rate must be ≤ Jev's, measured on the negatives split;
- p95 latency ≤ 300 ms on the chosen host.

**Rollout.** `LAYA_URL` already routes decisions to Laya with Jev as the fallback, and `/api/health` reports which
engine answered. Shadow first (call both, log disagreements), then switch the pre-filter (cheapest, least visible),
then re-check, then typo, then the gates. Keep a Jev key configured until a full week of shadow traffic agrees.

**Hosting.** CPU is enough to start (~200–460 ms per call, comparable to Jev today); a small GPU box brings it to
~33 ms and makes §3's "no generation in the hot path" genuinely instant. `services/laya/` ships the service and a
Dockerfile; it runs anywhere that takes a container.
