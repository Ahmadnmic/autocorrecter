// Builds a fine-tuning dataset for Laya in the format its training notebook expects:
//   {id, workflow, state: "<json>", questions: "<json>", gold: "<json>"}  (JSONL)
//
// Three sources, all for the four decisions this app actually makes (typo, recheck, prefilter, gate):
//   --outcomes   what real users kept or reverted, from the private event log. Ground truth, small.
//   --teacher    Jev's own answers on those same states. Distillation, large, needs JEV_API_KEY.
//   --synthetic  errors planted in known-good sentences (typo table, confusables, run-together words,
//                agreement slips) in English and Danish. Labels are correct by construction.
//
// Usage: node scripts/build-laya-dataset.mjs --outcomes --synthetic --teacher --out data/laya
import fs from "node:fs";
import path from "node:path";
import { COMMON_TYPOS, CONFUSABLES } from "../lib/text.ts";

const args = new Set(process.argv.slice(2));
const outDir = (() => {
  const i = process.argv.indexOf("--out");
  return i > 0 ? process.argv[i + 1] : "data/laya";
})();
const rows = [];
let n = 0;
const add = (workflow, state, questions, gold) => rows.push({ id: `${workflow}-${n++}`, workflow, state: JSON.stringify(state), questions: JSON.stringify(questions), gold: JSON.stringify(gold) });

// ---------- shared question shapes (identical to the ones the API asks in production) ----------
const typoQuestions = (word, candidates) => ({
  choice: { type: "choice", instructions: `Which word did the writer intend instead of "${word}"?`, criteria: Object.fromEntries([["keep", `Keep "${word}" as typed.`], ...candidates.map((c, i) => [`opt_${i}`, `Replace with "${c}".`])]) },
  intentional: { type: "noul", instructions: "Was the word typed on purpose (a name, slang, another language, a deliberate spelling)?" },
});
const recheckQuestions = (word, alternatives) => ({
  choice: { type: "choice", instructions: `Which word is right in this sentence: "${word}" or one of the alternatives?`, criteria: Object.fromEntries([["keep_original", `Keep "${word}".`], ...alternatives.map((a, i) => [`alt_${i}`, `Replace with "${a}".`])]) },
});
const prefilterQuestions = () => ({ worth_it: { type: "noul", instructions: "Does the window contain at least one word that is clearly wrong in context and should be replaced?" } });

// ---------- 1. synthetic: plant a known error in a clean sentence ----------
const CLEAN = {
  en: [
    "I put the keys there and left the house before it started raining",
    "The report was sent to the client last week and they were happy with the result",
    "We need to discuss the budget before we make a final decision about the project",
    "She is taller than me and it had a big effect on the team this season",
    "Tomorrow I will go through the numbers once more and then we can begin",
    "Can you help me with it later today or should I ask someone else first",
  ],
  da: [
    "Vi skal huske at sende det til ham før mødet i morgen tidlig",
    "Jeg ville gerne høre om rapporten er klar til på fredag",
    "Det er svært at vide hvad man skal gøre når der er mange muligheder",
    "Han sagde at han ikke kunne nå det før på mandag",
  ],
};
const RUN_TOGETHER = { en: [["canyouhelp", "can you help"], ["iwantto", "I want to"], ["ofcourse", "of course"], ["alot", "a lot"], ["thankyou", "thank you"]], da: [["jegvilgerne", "jeg vil gerne"], ["ikkenoget", "ikke noget"]] };
const AGREEMENT = { en: [["they were", "they was"], ["we went", "we goes"], ["he doesn't", "he don't"], ["was sent", "was send"]], da: [["at sende", "og sende"], ["nogle af", "nogen af"]] };

function synthetic() {
  for (const lang of ["en", "da"]) {
    // a) typo table: the misspelling is the input, the correct word is gold
    for (const [typo, correct] of Object.entries(COMMON_TYPOS[lang]).slice(0, 120)) {
      const sentence = CLEAN[lang][0];
      add("typo", { task: "Inline autocorrect while typing.", language: lang, left_context: sentence.slice(0, 40), typed_word: typo, candidates: [correct] }, typoQuestions(typo, [correct]), { choice: "opt_0", intentional: 0.05 });
      // the correct spelling must be left alone
      add("typo", { task: "Inline autocorrect while typing.", language: lang, left_context: sentence.slice(0, 40), typed_word: correct, candidates: [typo] }, typoQuestions(correct, [typo]), { choice: "keep", intentional: 0.9 });
    }
    // b) confusables in and out of context
    for (const [word, alts] of Object.entries(CONFUSABLES[lang] ?? {}).slice(0, 80)) {
      for (const clean of CLEAN[lang]) {
        if (!clean.toLowerCase().includes(` ${word} `)) continue;
        add("recheck", { task: "Inline autocorrect re-check.", language: lang, sentence: clean, word, alternatives: alts }, recheckQuestions(word, alts), { choice: "keep_original" });
        const wrong = alts[0];
        add("recheck", { task: "Inline autocorrect re-check.", language: lang, sentence: clean.replace(` ${word} `, ` ${wrong} `), word: wrong, alternatives: [word, ...alts.slice(1)] }, recheckQuestions(wrong, [word, ...alts.slice(1)]), { choice: "alt_0" });
      }
    }
    // c) run-together words: the split is gold
    for (const [joined, split] of RUN_TOGETHER[lang]) {
      add("typo", { task: "Inline autocorrect: the writer ran words together.", language: lang, left_context: "", typed_word: joined, candidates: [split] }, typoQuestions(joined, [split]), { choice: "opt_0", intentional: 0.05 });
    }
    // d) pre-filter: a window with a planted agreement error vs the clean one
    for (const [good, bad] of AGREEMENT[lang]) {
      for (const clean of CLEAN[lang]) {
        if (!clean.includes(good)) continue;
        add("prefilter", { task: "Inline autocorrect pre-filter.", language: lang, window: clean.replace(good, bad) }, prefilterQuestions(), { worth_it: 0.95 });
        add("prefilter", { task: "Inline autocorrect pre-filter.", language: lang, window: clean }, prefilterQuestions(), { worth_it: 0.05 });
      }
    }
  }
}

// ---------- 2. outcomes: what users kept or reverted ----------
async function outcomes() {
  const { listPrivate, readPrivateJson } = await import("../lib/store.ts");
  const days = [...Array(14)].map((_, i) => new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10));
  for (const day of days) {
    let cursor;
    do {
      const page = await listPrivate({ prefix: `logs/${day}/`, limit: 1000, cursor });
      cursor = page.hasMore ? page.cursor : undefined;
      for (const b of page.blobs.filter((b) => /-client(-[A-Za-z0-9]+)?\.json$/.test(b.pathname))) {
        const ev = await readPrivateJson(b.url);
        const i = ev?.in ?? {};
        if (!i.old || !i.to || i.changeKind === "grammar") continue;
        const lang = ev.lang ?? "en";
        const kept = ev.kind === "applied" || ev.kind === "resolved";
        add("typo", { task: "Inline autocorrect while typing.", language: lang, left_context: String(i.left ?? "").slice(-120), typed_word: i.old, candidates: [i.to] }, typoQuestions(i.old, [i.to]), { choice: kept ? "opt_0" : "keep", intentional: kept ? 0.1 : 0.85 });
      }
    } while (cursor);
  }
}

// ---------- 3. teacher: Jev's answers on the same states ----------
async function teacher() {
  const { jevDecide } = await import("../lib/jev.ts");
  const todo = rows.filter((r) => r.workflow !== "prefilter").slice(0, 4000);
  let done = 0;
  for (const r of todo) {
    try {
      const ans = await jevDecide(JSON.parse(r.state), JSON.parse(r.questions), 4000);
      const gold = JSON.parse(r.gold);
      // Keep the teacher's distribution alongside the hard label the outcome gives us.
      gold.teacher = Object.fromEntries(Object.entries(ans).map(([k, v]) => [k, v.choice ?? v.noul ?? v.score]));
      r.gold = JSON.stringify(gold);
    } catch {}
    if (++done % 200 === 0) console.log(`teacher: ${done}/${todo.length}`);
  }
}

if (args.has("--synthetic")) synthetic();
if (args.has("--outcomes")) await outcomes();
if (args.has("--teacher")) await teacher();

fs.mkdirSync(outDir, { recursive: true });
const shuffled = rows.sort(() => Math.random() - 0.5);
const cut = Math.floor(shuffled.length * 0.85);
for (const [name, part] of [["train", shuffled.slice(0, cut)], ["test", shuffled.slice(cut)]]) {
  fs.writeFileSync(path.join(outDir, `${name}.jsonl`), part.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`${name}: ${part.length} cases -> ${path.join(outDir, `${name}.jsonl`)}`);
}
const byWorkflow = {};
for (const r of rows) byWorkflow[r.workflow] = (byWorkflow[r.workflow] ?? 0) + 1;
console.log("by workflow:", byWorkflow);
