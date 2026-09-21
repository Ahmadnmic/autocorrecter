# Inline Contextual Autocorrect — Plan v3 (built and deployed)

Live: https://inline-autocorrect.vercel.app (Vercel team nmic-demo, region fra1). Code: `inline-autocorrect/`.

## 1. What changed since v2
| v2 (native macOS plan) | v3 (what was built) |
|---|---|
| Swift app, system-wide via Accessibility API | Next.js 16 web app on Vercel; a Google-Docs-style editor page is the product |
| `NSSpellChecker` candidates | Hunspell via `nspell` with `dictionary-en` / `dictionary-da` on the server |
| Idle-debounced context pass | No idle timers anywhere: every finished word triggers all passes; the Haiku pass runs back-to-back with one request in flight |
| Apply immediately, undo after | Highlight + popup above the word with a 2 s countdown; click to apply now, × / Esc to keep, Backspace right after to undo |
| – | Tone setting (as written, neutral, formal, professional, casual, friendly, academic, concise) feeds the proposer and the Jev gate |
| – | Translation: with English or Dansk chosen explicitly, a word from the other language is translated in place (Haiku translates, Jev gates) |
| – | Anti-AI-slop ruleset (`rules/`), 279 banned English + 89 Danish words, hard-filtered before the gate |
| – | Auto-type demo: half a page with planted typos, confusables and a wrong word, typed at human speed |

## 2. Roles (verified against docs)
- **Jev** (`POST https://www.jevai.org/api/v1/decisions`, `choice` / `noul` / `score`, 70–500 ms, ~$0.04 per 1M tokens): judge and gate. Never generates text.
- **Claude Haiku 4.5** (`claude-haiku-4-5`, raw HTTP, `output_config.format` = json_schema, system prompt marked for caching): proposer for better words and translations.
- **Hunspell** (server): typo candidates. A local common-typo table answers the most frequent ones with no API call.

## 3. Passes, all triggered by "word committed" (space, punctuation, Enter)
- **A – typo fix** `/api/decide`: skip rules → common-typo table → Hunspell known? → translation branch (explicit language only) → Hunspell candidates → Jev `intentional` noul + `fix` choice. Apply if not intentional and confidence ≥ T_typo.
- **B – re-check** `/api/recheck`: the 4 words before the committed word that are confusables (their/there, og/at …) or earlier Pass A fixes get Jev `choice` with left+right context, all in one request. Apply if ≥ T_recheck. Can revert a Pass A fix; the reverted word is then never touched again.
- **C – better word / tone** `/api/propose`: Jev `worth_it` noul pre-filter → Haiku structured proposals (≤3) with tone guidance → anti-slop hard filter → Jev `choice` + `prefers` noul per proposal. Coalesced: one in flight, stale snapshot re-fires on return. Never touches the last two words.

Thresholds come from one aggressiveness slider (`lib/thresholds.ts`).

## 4. Editing safety (implemented)
Versioned edit log with relocation of late decisions; cancel-and-replace of in-flight A/B requests; never touch the caret word or pending ranges; frozen ranges for 3 commits after a change; Backspace-undo and per-change revert in the panel; cancelled/reverted words go on a session never-correct list; casing transfer; batched insertions ≤ 64 chars are scanned for a commit, larger pastes are not evaluated; passes that need missing keys are skipped client-side.

## 5. Current state (2026-09-21, end of session)
- **Jev host:** TypeSafe official API via the `JEV` key (`api.typesafe.ai/v1/systemone`, ~220–300 ms per batched request, no throttling observed at 3 req/s). The client also supports Vercel AI Gateway (`AI_GATEWAY_API_KEY`, preferred when set) and the jevai.org community hub (keys starting with `jev_`, ~10–20 req/min, which is why it was replaced).
- **Batched pipeline:** every open question (autocomplete, up to 10 typo checks, up to 8 re-checks, the Haiku pre-filter) travels in one `/api/jev` request; up to 3 in flight, adaptive send gap that drops to 60 ms when nothing is rate-limited.
- **Autocomplete:** frequency list plus Hunspell base words as candidates (30–40), Jev picks with context from 2 letters. Probability is summed over a word family (document/documents/documentation); a decisive single word is completed with a trailing space, an open ending is completed to the family's common stem without a space. Two-letter prefixes fire only when decisive. Calibration (calibrate.mjs, 136-word text): 3-letter prefixes complete 35 of 57 long words, 30 exact, 4 stem-only, 1 wrong. Completed words are re-checked for 8 following words with a dedicated tense/number question (fixes "number" → "numbers"; tense such as schedule/scheduled stays uncertain).
- **Instant changes** (no countdown), highlighted for 5 s, listed in the right sidebar with Revert; Backspace right after a change undoes it.
- **Grammar fixer** (local, instant): double spaces, space before , . ; : ! ? ), space after opening ( and quotes, space before closing quotes, missing space after punctuation, capital after sentence end and at paragraph start.
- **Haiku** only behind the Jev pre-filter (threshold 0.6 at default aggressiveness), at sentence ends or every 5th word, and for translations of words that exist only in the other language's dictionary.
- **Demo:** two lines typed with the system off (text stays untouched and is locked), then five lines with it on; English with three Danish words for translation; autocomplete points marked in the script.
- **Layout:** Settings + Activity left, document centered, Changes right; below 1100 px both become hamburger drawers.

## 6. Platforms (2026-09-21, later the same day)
- **Desktop 0.1.2** (macOS arm64/x64, Windows x64): Electron tray app, uiohook keyboard hook with US/Danish key maps, corrections typed via System Events / SendKeys, chips overlay, settings window with Revert, feature requests, in-place self-update from `/api/desktop-version`. Ad-hoc signed only: macOS needs "Open Anyway" once.
- **Android**: spell checker service (recommended, any keyboard) + keyboard; signed APK built by GitHub Actions, published as a release; link in the manifest.
- **Learning loop**: `/api/log` (client outcomes) + per-route logs → `/api/learn` cron aggregates (min support 2, reverts veto) → one Haiku vetting call per batch → `/api/library` (versioned) → clients apply learned fixes instantly; every 50 entries a "library release" flag prompts the apps.
- **Open**: Vercel ↔ GitHub link needs the Vercel GitHub app authorised by the account owner; proper code signing (Apple Developer ID + notarisation, Windows Authenticode) to remove the Gatekeeper/SmartScreen warnings; security review pending.

## 7. Still open (older)
1. Threshold calibration on a labelled corpus (typo 0.75, re-check 0.85, complete 0.80, context 0.80 are starting points).
2. Daily spend cap for Haiku.
3. "kunden" → "the customer" duplicated the article once; a rule now drops a leading article already typed. Watch for other multi-word translations.
4. Danish confusables list is short; the ruleset's Danish regex patterns are not applied at runtime.
