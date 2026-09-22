// Pass C: better word in context. Jev pre-filter -> Haiku proposes -> Jev gates.
import { NextResponse } from "next/server";
import { jevConfigured, jevDecide, JevError } from "@/lib/jev";
import { anthropicConfigured, proposeImprovements, rewriteSentence, translateSentence, HaikuError } from "@/lib/haiku";
import { thresholds } from "@/lib/thresholds";
import { nthWordOccurrence, transferCase, type Lang } from "@/lib/text";
import { detectLangByDictionary } from "@/lib/spell";
import { introducesMachinePunctuation, isSlop } from "@/lib/slop";
import { logEvent, scrub } from "@/lib/log";
import { checkSecret, num, rateLimit, readJson, spendBudget, str, NO_STORE } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { window: string; lang?: Lang; aggressiveness?: number; tone?: string; skipPrefilter?: boolean; debug?: boolean; paused?: boolean; fmt?: string; chosenLang?: string };
const TONES = new Set(["as-written", "neutral", "formal", "professional", "casual", "friendly", "academic", "concise"]);

/** The last complete sentence of the window (5+ words), with its offset, or null. */
function lastSentenceOf(window: string): { text: string; offset: number } | null {
  const trimmed = window.replace(/\s+$/, "");
  const m = /(?:^|[.!?\n]\s*)([^.!?\n]{12,})[.!?]?$/.exec(trimmed);
  if (!m) return null;
  const text = m[1].trim();
  if (text.split(/\s+/).length < 5) return null;
  const offset = trimmed.lastIndexOf(text);
  return offset >= 0 ? { text, offset } : null;
}

export async function POST(req: Request) {
  const t0 = Date.now();
  const limited = rateLimit(req, "propose", 30, 15);
  if (limited) return limited;
  const over = spendBudget(5);
  if (over) return over;
  const parsed = await readJson<Body>(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.body;
  const window = str(body.window, 1200);
  const lang: Lang = body.lang === "da" ? "da" : "en";
  const T = thresholds(num(body.aggressiveness, 0, 1, 0.5));
  const tone = TONES.has(String(body.tone)) ? String(body.tone) : "as-written";
  const toneNote = tone === "as-written" ? "" : ` The author wants a ${tone} tone; a single word that clearly clashes with that tone also counts.`;
  if (window.trim().split(/\s+/).length < 4) return NextResponse.json({ approved: [], why: "too_short" });

  const missing = [!jevConfigured() && "JEV_API_KEY", !anthropicConfigured() && "ANTHROPIC_API_KEY"].filter(Boolean);
  if (missing.length) return NextResponse.json({ approved: [], why: "not_configured", missing }, { status: 503 });

  try {
    // 1. Pre-filter: is Haiku worth calling for this window? (skipped when the batched /api/jev call already said yes)
    const pre = body.skipPrefilter ? { worth_it: { noul: 1, raw: null } } : await jevDecide(
      { task: "Inline editing while the user types. Decide whether this window likely contains one word that a careful editor would clearly replace (wrong word for the meaning, grammar, collocation)." + (toneNote || " Style preferences do not count."), language: lang, tone, window },
      { worth_it: { type: "noul", instructions: "Does the window contain at least one word that is clearly wrong in context and should be replaced?" } },
    );
    const worth = pre.worth_it.noul ?? 1;
    if (worth < T.prefilter) {
      logEvent({ route: "propose", ms: Date.now() - t0, lang, in: { window: scrub(window).slice(-240), tone }, out: { worth, why: "prefiltered" } });
      return NextResponse.json({ approved: [], why: "prefiltered", worth, ms: Date.now() - t0 });
    }

    // 2. Haiku proposes.
    // Tone mode returns more proposals and runs longer; the function budget is 15 s.
    const tHaiku0 = Date.now();
    const fmt = body.fmt === "schema" || body.fmt === "free" ? body.fmt : undefined;
    // On a pause the last sentence is finished: alongside the word proposals, ask for a minimal rewrite when it does
    // not read as a coherent line. Both calls run at the same time.
    const lastSentence = body.paused === true ? lastSentenceOf(window) : null;
    // A language chosen by hand (not Auto) means: this is what I am writing in. A finished sentence in the other
    // language is translated whole, instead of word by word.
    const chosen = body.chosenLang === "en" || body.chosenLang === "da" ? body.chosenLang : null;
    if (chosen && lastSentence) {
      const detected = await detectLangByDictionary(lastSentence.text, 400);
      if (detected.lang && detected.lang !== chosen) {
        const tr = await translateSentence(lastSentence.text, chosen, tone).catch(() => null);
        if (tr) {
          const g = await jevDecide(
            { task: "Inline autocorrect. The writer picked a language by hand and typed a sentence in the other one, so it was translated. Approve only a faithful translation that keeps their meaning and register.", target_language: chosen, original_sentence: lastSentence.text, translation: tr.to },
            {
              choice: { type: "choice", instructions: "Which should stand in the writer's message?", criteria: { keep_original: "Keep the sentence as typed.", use_translation: "Use the translation." } },
              faithful: { type: "noul", instructions: "Is the translation faithful: same meaning, same register, nothing added or dropped?" },
            },
          );
          const conf = g.choice?.confidence ?? 0;
          if (g.choice?.choice === "use_translation" && conf >= 0.7 && (g.faithful?.noul ?? 0) >= 0.75) {
            logEvent({ route: "propose", ms: Date.now() - t0, lang, in: { window: scrub(window).slice(-240), tone, chosenLang: chosen }, out: { translated: scrub(tr.to).slice(0, 120), confidence: conf } });
            return NextResponse.json({ approved: [], rewrite: { original: lastSentence.text, offset: lastSentence.offset, to: tr.to, confidence: conf, reason: tr.reason, kind: "translate" }, ms: Date.now() - t0 }, { headers: NO_STORE });
          }
        }
      }
    }
    const [proposals, rewriteRaw] = await Promise.all([
      proposeImprovements(window, lang, tone, tone === "as-written" ? 6000 : 11000, body.paused === true, fmt),
      lastSentence ? rewriteSentence(lastSentence.text, lang, 5000, tone).catch(() => null) : Promise.resolve(null),
    ]);
    const tHaiku = Date.now() - tHaiku0;
    let rewrite: { original: string; offset: number; to: string; confidence: number; reason: string } | undefined;
    let rewriteWhy = rewriteRaw ? "" : lastSentence ? "haiku_none" : "no_sentence";
    const bare = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}'’ ]+/gu, " ").replace(/\s+/g, " ").trim();
    // Punctuation inside the sentence is a real repair (a missing comma before a clause, a comma splice). A full stop
    // or a capital added at the ends is not: a text message without them is fine as written.
    const innerPunct = (s: string) => s.trim().replace(/^[^\p{L}\p{N}]+/u, "").replace(/[^\p{L}\p{N}]+$/u, "").replace(/[^,;:—–-]+/g, "");
    if (lastSentence && rewriteRaw && bare(rewriteRaw.to) === bare(lastSentence.text) && innerPunct(rewriteRaw.to) === innerPunct(lastSentence.text)) rewriteWhy = "ends_only";
    // Never hand the writer an em dash, en dash or ellipsis character they were not already using.
    if (lastSentence && rewriteRaw && introducesMachinePunctuation(window, rewriteRaw.to)) rewriteWhy = "machine_punctuation";
    if (lastSentence && rewriteRaw && !rewriteWhy) {
      const g = await jevDecide(
        { task: `Inline autocorrect on a phone. A repair of one typed sentence was proposed. Approve only if it clearly says what the writer meant, more readably, without adding or changing meaning${tone === "as-written" ? "" : `, and fits the ${tone} tone the writer asked for`}.`, language: lang, tone, original_sentence: lastSentence.text, proposed_sentence: rewriteRaw.to, proposer_reason: rewriteRaw.reason },
        {
          choice: { type: "choice", instructions: "Which should stand in the writer's message?", criteria: { keep_original: "Keep the original sentence.", use_rewrite: "Use the proposed sentence." } },
          meaning: { type: "noul", instructions: "Does the proposed sentence keep exactly the writer's intended meaning?" },
          needed: { type: "noul", instructions: `Was the original sentence hard to read, ungrammatical, or missing punctuation a reader needs (for example a comma between two clauses)${tone === "as-written" ? "" : `, or clearly wrong for the ${tone} tone the writer asked for`}, so that a repair is needed at all?` },
        },
      );
      const conf = g.choice?.confidence ?? 0;
      // A repair is a bigger, visible, revertible edit on a sentence that already reads badly, so the bar is a little
      // lower than for a silent word swap; "needed" keeps fine sentences untouched.
      if (g.choice?.choice === "use_rewrite" && conf >= T.ctx - 0.15 && (g.meaning?.noul ?? 0) >= 0.65 && (g.needed?.noul ?? 0) >= 0.6) rewrite = { original: lastSentence.text, offset: lastSentence.offset, to: rewriteRaw.to, confidence: conf, reason: rewriteRaw.reason };
      else rewriteWhy = `gate choice=${g.choice?.choice} conf=${conf} meaning=${g.meaning?.noul} needed=${g.needed?.noul}`;
    }
    const rewriteDebug = body.debug === true && !checkSecret(req, "ADMIN_SECRET") ? { sentence: lastSentence?.text, raw: rewriteRaw, why: rewriteWhy } : undefined;
    // Hard anti-slop filter: no banned alternative ever reaches the gate, whatever the model said.
    const located = proposals
      // Model output is untrusted: alternatives must be short plain text, never line breaks or markup.
      .map((p) => ({ ...p, alternatives: p.alternatives.filter((a) => typeof a === "string" && a.length <= 40 && !/[\r\n<>]/.test(a) && !isSlop(a) && !introducesMachinePunctuation(window, a)), offset: nthWordOccurrence(window, p.original, p.occurrence) }))
      .filter((p) => p.offset >= 0 && p.alternatives.length > 0);
    if (located.length === 0) {
      if (rewrite) logEvent({ route: "propose", ms: Date.now() - t0, lang, in: { window: scrub(window).slice(-240), tone, paused: true }, out: { rewrite: { original: scrub(rewrite.original), to: scrub(rewrite.to), confidence: rewrite.confidence } } });
      return NextResponse.json({ approved: [], rewrite, why: rewrite ? undefined : "no_proposals", worth, ms: Date.now() - t0, t: { haiku: tHaiku }, rewriteDebug });
    }

    // 3. Jev gates each proposal.
    const state: Record<string, unknown> = { task: "Inline autocorrect gate. A proposer suggested word replacements. Approve only replacements the author would clearly want; when in doubt keep the original." + toneNote, language: lang, tone, window };
    const questions: Record<string, { type: "choice"; instructions: string; criteria: Record<string, string> } | { type: "noul"; instructions: string }> = {};
    // The whole sentence that holds the word, with the first alternative substituted: Jev judges a complete sentence,
    // never a fragment cut mid-word.
    const sentenceWith = (p: (typeof located)[number]) => {
      const preview = window.slice(0, p.offset) + p.alternatives[0] + window.slice(p.offset + p.original.length);
      const before = preview.slice(0, p.offset);
      const startM = /[.!?]\s+(?=[^.!?]*$)/.exec(before);
      const start = startM ? startM.index + startM[0].length : 0;
      const after = preview.slice(p.offset + p.alternatives[0].length);
      const endM = /[.!?]/.exec(after);
      const end = p.offset + p.alternatives[0].length + (endM ? endM.index + 1 : after.length);
      return preview.slice(start, end).trim();
    };
    located.forEach((p, i) => {
      state[`proposal_${i}`] = { original: p.original, position: p.offset, alternatives: p.alternatives, proposer_reason: p.reason, sentence_with_replacement: sentenceWith(p) };
      const criteria: Record<string, string> = { keep_original: `Keep "${p.original}".` };
      p.alternatives.forEach((alt, j) => (criteria[`alt_${j}`] = `Replace with "${alt}".`));
      questions[`choice_${i}`] = { type: "choice", instructions: `For proposal_${i}: which word is right in context?`, criteria };
      questions[`prefers_${i}`] = { type: "noul", instructions: `For proposal_${i}: would the author clearly prefer the best replacement over their original word?` };
      questions[`reads_${i}`] = { type: "noul", instructions: `For proposal_${i}: read sentence_with_replacement (it may be unfinished at the end, and it may still contain other, unrelated mistakes; ignore both). Does the replacement itself fit its slot grammatically and keep the intended meaning?` };
    });
    const tGate0 = Date.now();
    const gate = await jevDecide(state, questions);
    const tGate = Date.now() - tGate0;
    // Gate details for tuning; only with the admin secret.
    const debug = body.debug === true && !checkSecret(req, "ADMIN_SECRET") ? located.map((p, i) => ({ original: p.original, alternatives: p.alternatives, category: p.category, reason: p.reason, choice: gate[`choice_${i}`]?.choice, confidence: gate[`choice_${i}`]?.confidence, prefers: gate[`prefers_${i}`]?.noul, reads: gate[`reads_${i}`]?.noul })) : undefined;
    const approved = located
      .map((p, i) => {
        const c = gate[`choice_${i}`] ?? {};
        const n = gate[`prefers_${i}`]?.noul ?? 0;
        const reads = gate[`reads_${i}`]?.noul ?? 1;
        if (reads < 0.75) return null;
        const m = /^alt_(\d+)$/.exec(c.choice ?? "keep_original");
        const to = m ? p.alternatives[Number(m[1])] : undefined;
        const conf = c.confidence ?? 0;
        const isTone = p.category === "tone";
        // Tone changes are a stated preference, not an error claim: the gate is lower for them. For error claims the
        // choice confidence and the readability check carry the decision; "author would prefer" is a style signal, so
        // it only has to be clearly above even.
        if (!to || conf < (isTone ? T.ctx - 0.2 : T.ctx - 0.05) || n < (isTone ? T.prefers - 0.2 : T.prefers - 0.2)) return null;
        return { original: p.original, offset: p.offset, to: transferCase(p.original, to), confidence: Math.min(conf, n), reason: p.reason, kind: p.category === "tone" || (tone !== "as-written" && /tone|formal|casual|register|slang|colloquial|informal/i.test(p.reason)) ? "tone" : "context" };
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
    logEvent({ route: "propose", ms: Date.now() - t0, lang, in: { window: scrub(window).slice(-240), tone }, out: { worth, proposed: located.map((p) => ({ original: scrub(p.original), alternatives: p.alternatives, category: p.category, reason: p.reason })), approved } });
    // A rewrite that only restates the approved word swaps adds nothing; the word swaps are the lighter edit.
    if (rewrite) {
      let withSwaps = lastSentence!.text;
      for (const a of approved) withSwaps = withSwaps.replace(a.original, a.to);
      if (bare(withSwaps) === bare(rewrite.to)) rewrite = undefined;
    }
    return NextResponse.json({ approved, rewrite, worth, proposed: located.length, ms: Date.now() - t0, t: { haiku: tHaiku, gate: tGate }, debug, rewriteDebug }, { headers: NO_STORE });
  } catch (e) {
    const err = e as JevError | HaikuError;
    console.error("propose failed:", err.message, (err as HaikuError).body ? JSON.stringify((err as HaikuError).body).slice(0, 300) : "");
    const detail = !checkSecret(req, "ADMIN_SECRET") ? `${err.message} ${JSON.stringify((err as HaikuError).body ?? "").slice(0, 400)}` : undefined;
    return NextResponse.json({ approved: [], why: "error", ms: Date.now() - t0, detail }, { status: err.status === 429 ? 429 : err.status === 503 ? 503 : 200, headers: NO_STORE });
  }
}
