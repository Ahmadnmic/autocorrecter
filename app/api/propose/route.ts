// Pass C: better word in context. Jev pre-filter -> Haiku proposes -> Jev gates.
import { NextResponse } from "next/server";
import { jevConfigured, jevDecide, JevError } from "@/lib/jev";
import { anthropicConfigured, proposeImprovements, HaikuError } from "@/lib/haiku";
import { thresholds } from "@/lib/thresholds";
import { nthWordOccurrence, transferCase, type Lang } from "@/lib/text";
import { isSlop } from "@/lib/slop";
import { logEvent, scrub } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { window: string; lang?: Lang; aggressiveness?: number; tone?: string; skipPrefilter?: boolean };
const TONES = new Set(["as-written", "neutral", "formal", "professional", "casual", "friendly", "academic", "concise"]);

export async function POST(req: Request) {
  const t0 = Date.now();
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const window = String(body.window ?? "").slice(-1200);
  const lang: Lang = body.lang === "da" ? "da" : "en";
  const T = thresholds(body.aggressiveness ?? 0.5);
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
    const proposals = await proposeImprovements(window, lang, tone);
    // Hard anti-slop filter: no banned alternative ever reaches the gate, whatever the model said.
    const located = proposals
      .map((p) => ({ ...p, alternatives: p.alternatives.filter((a) => !isSlop(a)), offset: nthWordOccurrence(window, p.original, p.occurrence) }))
      .filter((p) => p.offset >= 0 && p.alternatives.length > 0);
    if (located.length === 0) return NextResponse.json({ approved: [], why: "no_proposals", worth, ms: Date.now() - t0 });

    // 3. Jev gates each proposal.
    const state: Record<string, unknown> = { task: "Inline autocorrect gate. A proposer suggested word replacements. Approve only replacements the author would clearly want; when in doubt keep the original." + toneNote, language: lang, tone, window };
    const questions: Record<string, { type: "choice"; instructions: string; criteria: Record<string, string> } | { type: "noul"; instructions: string }> = {};
    located.forEach((p, i) => {
      const preview = window.slice(0, p.offset) + p.alternatives[0] + window.slice(p.offset + p.original.length);
      state[`proposal_${i}`] = { original: p.original, position: p.offset, alternatives: p.alternatives, proposer_reason: p.reason, text_after_first_alternative: preview.slice(Math.max(0, p.offset - 120), p.offset + p.alternatives[0].length + 120) };
      const criteria: Record<string, string> = { keep_original: `Keep "${p.original}".` };
      p.alternatives.forEach((alt, j) => (criteria[`alt_${j}`] = `Replace with "${alt}".`));
      questions[`choice_${i}`] = { type: "choice", instructions: `For proposal_${i}: which word is right in context?`, criteria };
      questions[`prefers_${i}`] = { type: "noul", instructions: `For proposal_${i}: would the author clearly prefer the best replacement over their original word?` };
      questions[`reads_${i}`] = { type: "noul", instructions: `For proposal_${i}: after the replacement (see text_after_first_alternative), is the sentence still grammatical and does it keep its meaning?` };
    });
    const gate = await jevDecide(state, questions);
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
        // Tone changes are a stated preference, not an error claim: the gate is lower for them.
        if (!to || conf < (isTone ? T.ctx - 0.2 : T.ctx) || n < (isTone ? T.prefers - 0.2 : T.prefers)) return null;
        return { original: p.original, offset: p.offset, to: transferCase(p.original, to), confidence: Math.min(conf, n), reason: p.reason, kind: p.category === "tone" || (tone !== "as-written" && /tone|formal|casual|register|slang|colloquial|informal/i.test(p.reason)) ? "tone" : "context" };
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
    logEvent({ route: "propose", ms: Date.now() - t0, lang, in: { window: scrub(window).slice(-240), tone }, out: { worth, proposed: located.map((p) => ({ original: scrub(p.original), alternatives: p.alternatives, category: p.category, reason: p.reason })), approved } });
    return NextResponse.json({ approved, worth, proposed: located.length, ms: Date.now() - t0 });
  } catch (e) {
    const err = e as JevError | HaikuError;
    return NextResponse.json({ approved: [], why: "error", detail: err.message, ms: Date.now() - t0 }, { status: err.status === 429 ? 429 : err.status === 503 ? 503 : 200 });
  }
}
