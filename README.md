# Inline Contextual Autocorrect

A Google-Docs-style editor that corrects and improves your words *while you type*, with no idle wait.

- **Pass A – typo fix.** The word you just finished is checked with Hunspell. Jev picks the intended word from the candidates using the sentence so far.
- **Pass B – re-check.** Each new word gives right-context to the words before it. Confusables (their/there, og/at) and earlier fixes are re-judged by Jev.
- **Pass C – better word in context.** Jev decides whether the last sentences are worth a Haiku call; Claude Haiku proposes a word that is clearly wrong for the meaning (or clashes with the chosen tone); Jev approves or rejects each proposal.

Before any change, the word is highlighted and a popup above it shows the replacement with a 2-second countdown. Click to apply now, × or `Esc` to keep your word, `Backspace` right after a change to undo it.

## Environment variables

| Name | Used for |
|---|---|
| `AI_GATEWAY_API_KEY` | **Preferred.** Jev via Vercel AI Gateway (`https://ai-gateway.vercel.sh/typesafe/v1/systemone`), billed through the Vercel team, high rate limits. Create it in the Vercel dashboard under AI Gateway → API keys. |
| `JEV_API_KEY` (or `JEV`) | Jev directly: a TypeSafe key from console.typesafe.ai (~1,200 req/min, paid) or a jevai.org community key starting with `jev_` (~10–20 req/min) |
| `ANTHROPIC_API_KEY` (or `CLAUDE`) | Claude Haiku 4.5 proposals (`POST https://api.anthropic.com/v1/messages`) |

Without keys the app still runs: common typos are fixed from a local table and the health dots stay red.

Set them on Vercel:

```bash
vercel env add JEV_API_KEY production --scope nmic-demo
vercel env add ANTHROPIC_API_KEY production --scope nmic-demo
vercel deploy --prod --scope nmic-demo
```

Or in the dashboard: Project → Settings → Environment Variables, then redeploy. `GET /api/health?force=1` performs one live call to each API and reports the result.

## Local development

```bash
cp .env.example .env.local   # fill in the keys
npm install
npm run dev
```

## Layout

```
app/page.tsx            editor UI, passes, countdown popups, undo, settings (aggressiveness, tone, language)
app/api/decide          Pass A  (Hunspell candidates + Jev choice)
app/api/recheck         Pass B  (Jev choice with right-context)
app/api/propose         Pass C  (Jev pre-filter → Haiku structured JSON → Jev gate)
app/api/health          key presence + live probe of each API
lib/text.ts             tokeniser, confusables, casing transfer, common-typo table
lib/jev.ts              Jev client (defensive response parsing)
lib/haiku.ts            Haiku client (raw HTTP, output_config json_schema, prompt caching)
lib/spell.ts            nspell loader (dictionary-en, dictionary-da)
lib/thresholds.ts       aggressiveness → decision thresholds
rules/                  anti-AI-slop ruleset (markdown + JSON used by the proposer)
```
