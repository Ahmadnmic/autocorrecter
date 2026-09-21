// Autocomplete: frequency-list candidates for the partial word, Jev picks with context.
// Applied instantly by the client only at confidence >= 0.95.
import { NextResponse } from "next/server";
import { completions, frequency } from "@/lib/freq";
import { jevConfigured, jevDecide, JevError } from "@/lib/jev";
import { resolveLang } from "@/lib/lang";
import { shouldSkip, transferCase } from "@/lib/text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIDENCE = 0.8;
type Body = { partial: string; left: string; lang?: string };

export async function POST(req: Request) {
  const t0 = Date.now();
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const partial = String(body.partial ?? "").trim();
  const left = String(body.left ?? "").slice(-400);
  if (partial.length < 3 || shouldSkip(partial)) return NextResponse.json({ complete: false, why: "too_short" });
  if (!jevConfigured()) return NextResponse.json({ complete: false, why: "jev_not_configured" }, { status: 503 });

  const { lang } = await resolveLang(body.lang, left + " " + partial, undefined);
  const [cands, selfFreq] = await Promise.all([completions(partial, lang, 8), frequency(partial, lang)]);
  if (cands.length === 0) return NextResponse.json({ complete: false, why: "no_candidates", ms: Date.now() - t0 });
  // If the partial is itself a very common word and no candidate is much more frequent, do not interrupt.
  if (selfFreq > 0 && cands[0].count < selfFreq * 3) return NextResponse.json({ complete: false, why: "partial_is_common_word", ms: Date.now() - t0 });

  const criteria: Record<string, string> = { none: "The writer is still typing; none of these is clearly the intended word yet." };
  cands.forEach((c, i) => (criteria[`w_${i}`] = `The writer is typing "${c.word}".`));
  try {
    const ans = await jevDecide(
      {
        task: "Inline autocomplete while the user types. Predict the word being typed from its first letters and the sentence so far. Choose none unless one word is almost certainly intended.",
        language: lang,
        left_context: left,
        partial_word: partial,
        candidates: cands.map((c) => c.word),
      },
      { word: { type: "choice", instructions: "Which word is the writer typing?", criteria } },
      1200,
    );
    const m = /^w_(\d+)$/.exec(ans.word.choice ?? "none");
    const conf = ans.word.confidence ?? 0;
    const to = m ? cands[Number(m[1])].word : undefined;
    const complete = !!to && conf >= CONFIDENCE;
    return NextResponse.json({
      complete,
      to: complete && to ? transferCase(partial, to) : undefined,
      confidence: conf,
      candidates: cands.map((c) => c.word),
      lang,
      ms: Date.now() - t0,
    });
  } catch (e) {
    const err = e as JevError;
    return NextResponse.json({ complete: false, why: "jev_error", detail: err.message, ms: Date.now() - t0 }, { status: err.status === 429 ? 429 : err.status === 503 ? 503 : 200 });
  }
}
