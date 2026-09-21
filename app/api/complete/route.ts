// Autocomplete: frequency-list candidates for the partial word, Jev picks with context.
// Applied instantly by the client only at confidence >= 0.95.
import { NextResponse } from "next/server";
import { rateLimit, readJson, spendBudget, str, word, NO_STORE } from "@/lib/guard";
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
  const limited = rateLimit(req, "complete", 240, 120);
  if (limited) return limited;
  const over = spendBudget(1);
  if (over) return over;
  const parsed = await readJson<Body>(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.body;
  const partial = word(body.partial, 32);
  const left = str(body.left, 400);
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
    return NextResponse.json({ complete: false, why: "jev_error", ms: Date.now() - t0 }, { status: err.status === 429 ? 429 : err.status === 503 ? 503 : 200, headers: NO_STORE });
  }
}
