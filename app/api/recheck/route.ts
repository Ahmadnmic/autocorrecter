// Pass B: re-check recent words now that right-context exists. Jev only, all items in one request.
import { NextResponse } from "next/server";
import { arr, id, num, rateLimit, readJson, spendBudget, str, strHead, word, NO_STORE } from "@/lib/guard";
import { jevConfigured, jevDecide, JevError } from "@/lib/jev";
import { thresholds } from "@/lib/thresholds";
import { transferCase, type Lang } from "@/lib/text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Item = { id: string; word: string; alternatives: string[]; left: string; right: string };
type Body = { items: Item[]; lang?: Lang; aggressiveness?: number };

export async function POST(req: Request) {
  const t0 = Date.now();
  const limited = rateLimit(req, "recheck", 120, 60);
  if (limited) return limited;
  const over = spendBudget(1);
  if (over) return over;
  const parsed = await readJson<Body>(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.body;
  const items: Item[] = arr<Partial<Item>>(body.items, 4)
    .map((it) => ({ ...it, id: id(it?.id), word: word(it?.word), alternatives: arr<unknown>(it?.alternatives, 3).map((a) => word(a)).filter(Boolean), left: str(it?.left, 300), right: strHead(it?.right, 200) }) as Item)
    .filter((it) => it.word && it.alternatives.length > 0);
  if (items.length === 0) return NextResponse.json({ decisions: [] });
  if (!jevConfigured()) return NextResponse.json({ decisions: [], why: "jev_not_configured", missing: ["JEV_API_KEY"] }, { status: 503 });
  const T = thresholds(num(body.aggressiveness, 0, 1, 0.5));
  const lang: Lang = body.lang === "da" ? "da" : "en";

  const state: Record<string, unknown> = {
    task: "Inline autocorrect. Each item is a word the writer typed a moment ago; now the words after it are known. Decide whether the word is right in its sentence.",
    language: lang,
  };
  const questions: Record<string, { type: "choice"; instructions: string; criteria: Record<string, string> }> = {};
  items.forEach((it, i) => {
    state[`item_${i}`] = { left_context: it.left.slice(-300), word: it.word, right_context: it.right.slice(0, 200) };
    const criteria: Record<string, string> = { keep: `Keep "${it.word}".` };
    it.alternatives.slice(0, 3).forEach((alt, j) => (criteria[`alt_${j}`] = `Replace with "${alt}".`));
    questions[`q_${i}`] = { type: "choice", instructions: `For item_${i}: which word is correct in this sentence? Choose keep unless a replacement is clearly right.`, criteria };
  });

  try {
    const ans = await jevDecide(state, questions);
    const decisions = items.map((it, i) => {
      const a = ans[`q_${i}`] ?? {};
      const m = /^alt_(\d+)$/.exec(a.choice ?? "keep");
      const conf = a.confidence ?? 0;
      const to = m ? it.alternatives[Number(m[1])] : undefined;
      const replace = !!to && conf >= T.recheck;
      return { id: it.id, replace, to: replace && to ? transferCase(it.word, to) : undefined, confidence: conf };
    });
    return NextResponse.json({ decisions, ms: Date.now() - t0 });
  } catch (e) {
    const err = e as JevError;
    return NextResponse.json({ decisions: [], why: "jev_error", ms: Date.now() - t0 }, { status: err.status === 429 ? 429 : err.status === 503 ? 503 : 200, headers: NO_STORE });
  }
}
