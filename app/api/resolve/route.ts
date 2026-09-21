// Late resolution of words the dictionary could not fix ("woyou" -> "would you", "ofcourse" -> "of course").
// Runs once a few words of right-context exist. Haiku proposes what was meant, Jev gates, in one batched call each.
import { NextResponse } from "next/server";
import { jevConfigured, jevDecide, JevError, type JevQuestion } from "@/lib/jev";
import { anthropicConfigured, anthropicKey, HaikuError } from "@/lib/haiku";
import { thresholds } from "@/lib/thresholds";
import { transferCase, type Lang } from "@/lib/text";
import { logEvent, scrub } from "@/lib/log";
import { arr, id, num, rateLimit, readJson, spendBudget, str, strHead, word, NO_STORE } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Item = { id: string; word: string; left: string; right: string };
type Body = { items: Item[]; lang?: Lang; aggressiveness?: number };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "replacement", "sure"],
        properties: { id: { type: "string" }, replacement: { type: "string" }, sure: { type: "boolean" } },
      },
    },
  },
} as const;

export async function POST(req: Request) {
  const t0 = Date.now();
  const limited = rateLimit(req, "resolve", 30, 15);
  if (limited) return limited;
  const over = spendBudget(5);
  if (over) return over;
  const parsed = await readJson<Body>(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.body;
  const items: Item[] = arr<Partial<Item>>(body.items, 6)
    .map((i) => ({ id: id(i?.id), word: word(i?.word), left: str(i?.left, 300), right: strHead(i?.right, 200) }))
    .filter((i) => i.id && i.word);
  if (!items.length) return NextResponse.json({ decisions: [] });
  if (!anthropicConfigured()) return NextResponse.json({ decisions: [], why: "not_configured" }, { status: 503 });
  const lang: Lang = body.lang === "da" ? "da" : "en";
  const T = thresholds(num(body.aggressiveness, 0, 1, 0.5));

  // 1. Haiku: what did the writer mean?
  const list = items.map((i) => `id=${i.id}\nbefore: …${i.left.slice(-160)}\nword: ${i.word}\nafter: ${i.right.slice(0, 120)}…`).join("\n\n");
  let proposals: { id: string; replacement: string; sure: boolean }[] = [];
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": anthropicKey(), "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 300,
        system: [
          {
            type: "text",
            text: `The writer is typing in ${lang === "da" ? "Danish" : "English"}. Each item is a word the spell-checker could not recognise or fix. Using the text before and after it, give the word or short phrase (1-3 words) the writer meant: a mistyped word ("recieve" -> "receive"), two words run together ("woyou" -> "would you", "ofcourse" -> "of course", "alot" -> "a lot"), or a keyboard slip. Keep the writer's language. Set sure=false when the word is a name, a code identifier, slang, another language, or genuinely ambiguous; then replacement may equal the word. Never rewrite anything except that word.`,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: list }],
        output_config: { format: { type: "json_schema", schema: SCHEMA } },
      }),
      signal: ctrl.signal,
      cache: "no-store",
    }).finally(() => clearTimeout(t));
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new HaikuError(`Anthropic HTTP ${res.status}`, res.status, json);
    const text = ((json.content as Array<{ type: string; text?: string }>) ?? []).find((c) => c.type === "text")?.text ?? "{}";
    proposals = (JSON.parse(text) as { items?: typeof proposals }).items ?? [];
  } catch (e) {
    void e;
    return NextResponse.json({ decisions: [], why: "haiku_error", ms: Date.now() - t0 }, { status: 200, headers: NO_STORE });
  }
  const usable = items
    .map((i) => ({ item: i, p: proposals.find((p) => p.id === i.id) }))
    .filter((x): x is { item: Item; p: { id: string; replacement: string; sure: boolean } } => !!x.p && x.p.sure && typeof x.p.replacement === "string" && !!x.p.replacement.trim() && x.p.replacement.length <= 48 && !/[\r\n<>]/.test(x.p.replacement) && x.p.replacement.trim().toLowerCase() !== x.item.word.toLowerCase() && x.p.replacement.trim().split(/\s+/).length <= 3);
  if (!usable.length) return NextResponse.json({ decisions: [], ms: Date.now() - t0 });

  // 2. Jev gate.
  if (!jevConfigured()) return NextResponse.json({ decisions: usable.map(({ item, p }) => ({ id: item.id, replace: true, to: transferCase(item.word, p.replacement.trim()), confidence: 0.8 })), ms: Date.now() - t0 });
  const state: Record<string, unknown> = { language: lang, task: "Inline autocorrect. The spell-checker could not fix these words; a proposer suggested what the writer meant. Approve only when the replacement is clearly right in context." };
  const questions: Record<string, JevQuestion> = {};
  usable.forEach(({ item, p }, i) => {
    state[`item_${i}`] = { left_context: item.left.slice(-300), typed_word: item.word, right_context: item.right.slice(0, 200), proposed: p.replacement.trim() };
    questions[`q_${i}`] = { type: "choice", instructions: `For item_${i}: what should the typed word become?`, criteria: { keep: `Keep "${item.word}" (a name, code, slang, or intended).`, fix: `Replace with "${p.replacement.trim()}".` } };
  });
  try {
    const ans = await jevDecide(state, questions, 1500);
    const decisions = usable.map(({ item, p }, i) => {
      const a = ans[`q_${i}`] ?? {};
      const conf = a.confidence ?? 0;
      const replace = a.choice === "fix" && conf >= T.typo;
      return { id: item.id, replace, to: replace ? transferCase(item.word, p.replacement.trim()) : undefined, confidence: conf };
    });
    logEvent({ route: "resolve", ms: Date.now() - t0, lang, in: items.map((i) => ({ word: scrub(i.word), left: scrub(i.left).slice(-80), right: scrub(i.right).slice(0, 60) })), out: { proposals: proposals.map((p) => ({ id: p.id, replacement: scrub(p.replacement), sure: p.sure })), decisions } });
    return NextResponse.json({ decisions, ms: Date.now() - t0 }, { headers: NO_STORE });
  } catch (e) {
    const err = e as JevError;
    logEvent({ route: "resolve", ms: Date.now() - t0, lang, in: items.map((i) => scrub(i.word)), out: { why: "jev_error" } });
    return NextResponse.json({ decisions: [], why: "jev_error", ms: Date.now() - t0 }, { status: err.status === 429 ? 429 : 200, headers: NO_STORE });
  }
}
