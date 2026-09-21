// One combined Jev request per call: autocomplete + typo fixes + re-checks + Haiku pre-filter.
// The client keeps a single request in flight and merges everything that happens meanwhile into the next one.
import { NextResponse } from "next/server";
import { completions, frequency, inFrequencyList } from "@/lib/freq";
import { jevConfigured, jevDecide, JevError, type JevQuestion } from "@/lib/jev";
import { resolveLang } from "@/lib/lang";
import { detectLangByDictionary, getSpeller } from "@/lib/spell";
import { thresholds } from "@/lib/thresholds";
import { COMMON_TYPOS, editDistance, shouldSkip, transferCase, type Lang } from "@/lib/text";
import { loadLibrary, lookup } from "@/lib/library";
import { logEvent, scrub } from "@/lib/log";
import { arr, id, num, oneOf, rateLimit, readJson, spendBudget, str, strHead, word, NO_STORE } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Autocomplete triggering follows the Smart Compose recipe: a confidence threshold chosen for a target
// trigger frequency, plus a margin over the runner-up so near-ties never fire. Tuned via calibrate.mjs.
const COMPLETE_MIN_PARTIAL = 2;
const COMPLETE_MARGIN = 1.8;

type Body = {
  lang?: string;
  doc?: string;
  client?: string;
  session?: string;
  aggressiveness?: number;
  tone?: string;
  complete?: { partial: string; left: string };
  typos?: { id: string; word: string; left: string }[];
  recheck?: { id: string; word: string; alternatives: string[]; left: string; right: string; completed?: boolean }[];
  prefilter?: { window: string };
};

export async function POST(req: Request) {
  const t0 = Date.now();
  const limited = rateLimit(req, "jev", 240, 120);
  if (limited) return limited;
  const over = spendBudget(1);
  if (over) return over;
  const parsed = await readJson<Body>(req);
  if ("error" in parsed) return parsed.error;
  let body = parsed.body;
  // Coerce every client field to a bounded value before anything reads it.
  body = {
    lang: oneOf(body.lang, ["auto", "en", "da"] as const, "auto"),
    doc: str(body.doc, 20000, "") || undefined,
    client: strHead(body.client, 16, "web"),
    session: strHead(body.session, 32, ""),
    aggressiveness: num(body.aggressiveness, 0, 1, 0.5),
    tone: oneOf(body.tone, ["as-written", "neutral", "formal", "professional", "casual", "friendly", "academic", "concise"] as const, "as-written"),
    complete: body.complete && typeof body.complete === "object" ? { partial: word(body.complete.partial, 32), left: str(body.complete.left, 400) } : undefined,
    typos: arr<{ id: unknown; word: unknown; left: unknown }>(body.typos, 10).map((t) => ({ id: id(t?.id), word: word(t?.word), left: str(t?.left, 400) })),
    recheck: arr<{ id: unknown; word: unknown; alternatives: unknown; left: unknown; right: unknown; completed?: unknown }>(body.recheck, 8).map((r) => ({ id: id(r?.id), word: word(r?.word), alternatives: arr<unknown>(r?.alternatives, 3).map((a) => word(a)).filter(Boolean), left: str(r?.left, 300), right: strHead(r?.right, 200), completed: r?.completed === true })),
    prefilter: body.prefilter && typeof body.prefilter === "object" ? { window: str(body.prefilter.window, 900) } : undefined,
  };
  const T = thresholds(body.aggressiveness ?? 0.5);
  const tone = body.tone ?? "as-written";
  const longestLeft = [body.complete?.left, ...(body.typos ?? []).map((t) => t.left), ...(body.recheck ?? []).map((r) => r.left)].filter(Boolean).sort((a, b) => (b?.length ?? 0) - (a?.length ?? 0))[0] ?? "";
  const { lang, detected, conclusive } = await resolveLang(body.lang, longestLeft, body.doc);
  const other: Lang = lang === "en" ? "da" : "en";
  const [speller, library] = await Promise.all([getSpeller(lang), loadLibrary()]);
  let otherSpeller: Awaited<ReturnType<typeof getSpeller>> | null = null; // loaded only if a word is unknown here

  const questions: Record<string, JevQuestion> = {};
  const state: Record<string, unknown> = { language: lang, tone };
  const out: {
    lang: Lang;
    detected: unknown;
    complete?: { complete: boolean; to?: string; confidence?: number; margin?: number | null; addSpace?: boolean; family?: string[]; candidates?: string[] };
    typos: { id: string; replace: boolean; to?: string; confidence?: number; foreign?: boolean; source?: string; unresolved?: boolean }[];
    recheck: { id: string; replace: boolean; to?: string; confidence?: number }[];
    prefilter?: { worth: number; callHaiku: boolean };
    ms?: number;
  } = { lang, detected, typos: [], recheck: [] };

  // --- autocomplete
  let acCands: { word: string; count: number }[] = [];
  if (body.complete && body.complete.partial.length >= COMPLETE_MIN_PARTIAL && !shouldSkip(body.complete.partial)) {
    const partial = body.complete.partial;
    const [cands, selfFreq] = await Promise.all([completions(partial, lang, partial.length <= 2 ? 40 : 30), frequency(partial, lang)]);
    if (cands.length && !(selfFreq > 0 && cands[0].count < selfFreq * 3)) {
      acCands = cands;
      const criteria: Record<string, string> = { none: "The writer is still typing; none of these is clearly the intended word yet." };
      cands.forEach((c, i) => (criteria[`w_${i}`] = `The writer is typing "${c.word}".`));
      state.autocomplete = { left_context: body.complete.left.slice(-300), partial_word: partial, candidates: cands.map((c) => c.word) };
      questions.ac = { type: "choice", instructions: "Autocomplete: which word is the writer typing, given the partial word and the text before it? Choose none unless one word is almost certainly intended.", criteria };
    } else out.complete = { complete: false };
  }

  // --- typos
  const typoMeta: Record<string, { word: string; original: string; suggestions: string[] }> = {};
  for (const t of (body.typos ?? []).slice(0, 10)) {
    const word = t.word.trim();
    if (!word || shouldSkip(word)) continue;
    const bare = word.replace(/^['’]+|['’]+$/g, "");
    const common = COMMON_TYPOS[lang][bare.toLowerCase()];
    if (common) {
      out.typos.push({ id: t.id, replace: true, to: transferCase(word, common), confidence: 0.99, source: "table" });
      continue;
    }
    const learned = lookup(library, bare);
    if (learned && (learned.lang === lang || !learned.lang)) {
      out.typos.push({ id: t.id, replace: true, to: transferCase(word, learned.to), confidence: 0.98, source: "library" });
      continue;
    }
    if (library.never.includes(bare.toLowerCase())) continue;
    if (!bare || speller.correct(bare) || speller.correct(bare.toLowerCase())) continue;
    // Foreign-word test: the other language's 50k frequency list (milliseconds) first; the other Hunspell
    // dictionary (seconds to parse on a cold instance) only for words with Danish letters.
    let foreign = false;
    if (conclusive && bare.length >= 2) {
      foreign = await inFrequencyList(bare.toLowerCase(), other);
      if (!foreign && (other === "da" ? /[æøå]/i.test(bare) : lang === "da")) {
        otherSpeller ??= await getSpeller(other);
        foreign = otherSpeller.correct(bare) || otherSpeller.correct(bare.toLowerCase());
      }
    }
    if (foreign) {
      const local = await detectLangByDictionary(t.left.slice(-90), 12);
      if (local.lang === other) foreign = false;
    }
    if (foreign) {
      out.typos.push({ id: t.id, replace: false, foreign: true }); // client asks /api/decide for a translation
      continue;
    }
    if (bare.length > 14) {
      out.typos.push({ id: t.id, replace: false, unresolved: true });
      continue;
    }
    const seen = new Set<string>();
    const lowerBare = bare.toLowerCase();
    // A single-word candidate must keep most of the typed letters ("woyou" -> "you" drops too much: that is two words,
    // resolved later with context), and stay within two edits.
    const suggestions = speller
      .suggest(bare)
      .map((s) => s.trim())
      .filter((s) => s && s.toLowerCase() !== lowerBare && !/\s/.test(s) && s.length >= bare.length - 1 && editDistance(s.toLowerCase(), lowerBare) <= 2 && !seen.has(s.toLowerCase()) && (seen.add(s.toLowerCase()), true))
      .slice(0, 5);
    // Two words run together ("ofcourse", "alot", "thankyou"): both halves must be real words.
    for (let k = 1; k <= lowerBare.length - 2; k++) {
      const a = lowerBare.slice(0, k);
      const b = lowerBare.slice(k);
      if ((a.length >= 2 || a === "a" || a === "i") && b.length >= 2 && speller.correct(a) && speller.correct(b) && !seen.has(`${a} ${b}`)) {
        seen.add(`${a} ${b}`);
        suggestions.push(`${a} ${b}`);
        if (suggestions.length >= 7) break;
      }
    }
    if (!suggestions.length) {
      out.typos.push({ id: t.id, replace: false, unresolved: true });
      continue;
    }
    const key = t.id.replace(/[^a-zA-Z0-9]/g, "_");
    typoMeta[key] = { word, original: t.id, suggestions };
    const criteria: Record<string, string> = { keep_as_typed: `Keep "${bare}" exactly as typed.` };
    suggestions.forEach((s, i) => (criteria[`opt_${i}`] = `Replace with "${s}".`));
    state[`typo_${key}`] = { left_context: t.left.slice(-300), typed_word: bare, candidates: suggestions };
    questions[`ti_${key}`] = { type: "noul", instructions: `For typo_${key}: is the typed word intended as written (a name, slang, jargon, another language, a deliberate spelling)?` };
    questions[`tf_${key}`] = { type: "choice", instructions: `For typo_${key}: the word is not in the dictionary. Which option is what the writer meant, given the left context? Prefer keep_as_typed unless a candidate is clearly intended.`, criteria };
  }

  // --- rechecks
  const recheckMeta: Record<string, { id: string; word: string; alternatives: string[] }> = {};
  for (const r of (body.recheck ?? []).slice(0, 8)) {
    if (!r.word || !r.alternatives?.length) continue;
    const key = r.id.replace(/[^a-zA-Z0-9]/g, "_");
    recheckMeta[key] = { id: r.id, word: r.word, alternatives: r.alternatives.slice(0, 3) };
    const criteria: Record<string, string> = { keep: `Keep "${r.word}".` };
    recheckMeta[key].alternatives.forEach((alt, j) => (criteria[`alt_${j}`] = `Replace with "${alt}".`));
    state[`recheck_${key}`] = { left_context: r.left.slice(-300), word: r.word, right_context: r.right.slice(0, 200) };
    questions[`rc_${key}`] = r.completed
      ? { type: "choice", instructions: `For recheck_${key}: this word was auto-completed from its first letters, so its ending (tense, number, part of speech) may be wrong. Now that the words after it are known, which form fits the sentence grammatically? Choose the correct form; choose keep only if the current form is right.`, criteria }
      : { type: "choice", instructions: `For recheck_${key}: the writer typed this word a moment ago and the words after it are now known. Which word is correct in this sentence? Choose keep unless a replacement is clearly right.`, criteria };
  }

  // --- pre-filter for the Haiku pass
  if (body.prefilter && body.prefilter.window.trim().split(/\s+/).length >= 6) {
    state.window = body.prefilter.window.slice(-900);
    const toneNote = tone === "as-written" ? " Style preferences do not count." : ` The author wants a ${tone} tone; a word that clearly clashes with it also counts.`;
    questions.pf = { type: "noul", instructions: "Does the window contain at least one word that is clearly wrong in context (wrong word for the meaning, grammar, collocation) and should be replaced?" + toneNote };
  }

  const finish = (payload: Record<string, unknown>, status = 200) => {
    logEvent({ route: "jev", ms: Date.now() - t0, lang, client: body.client, session: body.session, in: { complete: body.complete?.partial, typos: (body.typos ?? []).map((t) => scrub(t.word)), recheck: (body.recheck ?? []).map((r) => scrub(r.word)), prefilter: !!body.prefilter, tone }, out: { complete: out.complete, typos: out.typos, recheck: out.recheck, prefilter: out.prefilter, why: payload.why } });
    return NextResponse.json(payload, { status, headers: NO_STORE });
  };
  if (Object.keys(questions).length === 0) return finish({ ...out, ms: Date.now() - t0 });
  if (!jevConfigured()) return NextResponse.json({ ...out, why: "jev_not_configured" }, { status: 503 });

  try {
    const ans = await jevDecide(state, questions, 1500);
    if (questions.ac) {
      const partial = body.complete!.partial;
      const probs = ans.ac.probabilities ?? {};
      const probOf = (idx: number) => probs[`w_${idx}`] ?? 0;
      // Best candidate by probability (falls back to Jev's choice).
      let bestIdx = -1;
      acCands.forEach((_, i) => {
        if (bestIdx < 0 || probOf(i) > probOf(bestIdx)) bestIdx = i;
      });
      const m = /^w_(\d+)$/.exec(ans.ac.choice ?? "none");
      if (m && !Object.keys(probs).length) bestIdx = Number(m[1]);
      const noneProb = probs.none ?? (ans.ac.choice === "none" ? ans.ac.confidence ?? 0 : 0);
      let result: { complete: boolean; to?: string; confidence?: number; margin?: number | null; addSpace?: boolean; family?: string[]; candidates?: string[] } = { complete: false, confidence: noneProb, candidates: acCands.map((c) => c.word) };
      if (bestIdx >= 0) {
        const best = acCands[bestIdx].word;
        const bestP = probOf(bestIdx) || (m && Number(m[1]) === bestIdx ? ans.ac.confidence ?? 0 : 0);
        // Word family: inflections sharing the stem (document / documents / documentation). Their probability is
        // summed, because the writer is clearly typing that word even when the ending is still open.
        const stemLen = Math.max(partial.length + 2, best.length - 3);
        const stem = best.slice(0, stemLen).toLowerCase();
        let familyP = 0;
        let bestOutside = 0;
        const family: { word: string; count: number; p: number }[] = [];
        acCands.forEach((c, i) => {
          const pI = probOf(i);
          if (c.word.toLowerCase().startsWith(stem)) {
            familyP += pI;
            family.push({ word: c.word, count: c.count, p: pI });
          } else bestOutside = Math.max(bestOutside, pI);
        });
        if (!Object.keys(probs).length) familyP = bestP;
        bestOutside = Math.max(bestOutside, noneProb);
        const bar = partial.length <= 2 ? T.complete + 0.12 : T.complete;
        const margin = bestOutside > 0 ? familyP / bestOutside : Infinity;
        const decisive = bestP >= bar;
        // A two-letter prefix must not repeat a word (or its family) the writer just used ("their opinions op|enly").
        const recent = (body.complete!.left.split(/[^\p{L}'’-]+/u).slice(-12)).map((w) => w.toLowerCase());
        const repeats = partial.length <= 2 && recent.some((w) => w.startsWith(stem));
        // Ending uncertain: complete to the longest common prefix of the two most likely family members, if that is
        // itself a word in the family ("customer" for customer/customers); otherwise the shortest member that prefixes
        // the best one. The writer then adds the ending, so the completion is always a prefix of the intended word.
        const byP = [...family].sort((a, b) => b.p - a.p);
        let stemWord = best;
        if (byP.length >= 2) {
          const a = byP[0].word.toLowerCase();
          const b = byP[1].word.toLowerCase();
          let k = 0;
          while (k < a.length && k < b.length && a[k] === b[k]) k++;
          const lcp = a.slice(0, k);
          const asWord = family.find((f) => f.word.toLowerCase() === lcp);
          if (asWord) stemWord = asWord.word;
          else {
            const pref = family.filter((f) => a.startsWith(f.word.toLowerCase())).sort((x, y) => x.word.length - y.word.length)[0];
            stemWord = pref ? pref.word : byP[0].word;
          }
        }
        const target = decisive ? best : stemWord;
        const twoLetterOk = partial.length > 2 || decisive;
        const ok = !repeats && twoLetterOk && familyP >= bar && margin >= COMPLETE_MARGIN && target.length >= partial.length + 2;
        result = {
          complete: ok,
          to: ok ? transferCase(partial, target) : undefined,
          addSpace: ok ? decisive : undefined,
          family: ok ? family.filter((f) => f.word !== target).sort((a, b) => b.p - a.p).map((f) => f.word).slice(0, 4) : undefined,
          confidence: Math.round(Math.max(bestP, ok ? familyP : bestP) * 100) / 100,
          margin: Number.isFinite(margin) ? Math.round(margin * 10) / 10 : null,
          candidates: acCands.map((c) => c.word),
        };
      }
      out.complete = result;
    }
    for (const [key, meta] of Object.entries(typoMeta)) {
      const intentional = ans[`ti_${key}`]?.noul ?? 0;
      const choice = ans[`tf_${key}`]?.choice ?? "keep_as_typed";
      const conf = ans[`tf_${key}`]?.confidence ?? 0;
      const m = /^opt_(\d+)$/.exec(choice);
      const to = m ? meta.suggestions[Number(m[1])] : undefined;
      const replace = !!to && intentional < T.intentional && conf >= T.typo;
      // Not fixed and not clearly intentional: the client keeps watching it and asks again with more context.
      out.typos.push({ id: meta.original, replace, to: replace && to ? transferCase(meta.word, to) : undefined, confidence: conf, source: "jev", unresolved: !replace && intentional < 0.7 });
    }
    for (const [key, meta] of Object.entries(recheckMeta)) {
      const a = ans[`rc_${key}`] ?? {};
      const m = /^alt_(\d+)$/.exec(a.choice ?? "keep");
      const conf = a.confidence ?? 0;
      const to = m ? meta.alternatives[Number(m[1])] : undefined;
      const replace = !!to && conf >= T.recheck;
      out.recheck.push({ id: meta.id, replace, to: replace && to ? transferCase(meta.word, to) : undefined, confidence: conf });
    }
    if (questions.pf) {
      const worth = ans.pf.noul ?? 0;
      out.prefilter = { worth, callHaiku: worth >= (tone === "as-written" ? T.prefilter : T.prefilter - 0.2) };
    }
    return finish({ ...out, ms: Date.now() - t0 });
  } catch (e) {
    const err = e as JevError;
    return finish({ ...out, why: "jev_error", ms: Date.now() - t0 }, err.status === 429 ? 429 : err.status === 503 ? 503 : 200);
  }
}
