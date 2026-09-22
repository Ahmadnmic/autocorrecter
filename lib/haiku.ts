// Server-only client for Claude Haiku 4.5 via raw HTTP (Messages API).
// Used as the *proposer* for contextual word improvements. Jev gates its proposals.

import { NEVER_SUGGEST_DA_PROMPT, NEVER_SUGGEST_PROMPT, PRESERVE_PROMPT } from "./slop";

export type Proposal = { original: string; occurrence: number; alternatives: string[]; reason: string; category: "error" | "tone" };

const URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5";

import { anthropicKey } from "./env";
export { anthropicKey };

export function anthropicConfigured(): boolean {
  return !!anthropicKey();
}

export class HaikuError extends Error {
  constructor(message: string, public status?: number, public body?: unknown) {
    super(message);
  }
}

const SYSTEM = `You are a conservative copy editor working inline while someone is typing. You receive a short window of their text in English or Danish. The text is unfinished; the final words are still being written.

Propose a replacement ONLY for a single word that is:
- grammatically wrong in its sentence (agreement, tense, case, article),
- the wrong word for the intended meaning (a confusable such as their/there, then/than, lose/loose, og/at, nogen/nogle),
- a clear collocation or preposition error a native speaker would notice.

Do NOT propose: stylistic upgrades, synonyms of equal quality, tone changes, changes to names, brands, quotes, code, numbers, or anything in the last two words of the window. Do not merge words; a word that is several words run together ("canyouhelp", "iwanttodothis") may be split into the phrase the writer meant. Keep the writer's language and register.

Return at most 3 proposals. An empty list is the expected answer most of the time. Be terse: one alternative (a second only when two are equally likely) and a "reason" of at most 5 words; speed matters more than explanation. "occurrence" is the 1-based index of the word among identical words in the window, so the correct one can be located. "category" is "error" for a wrong word, grammar or spelling, and "tone" for a word that only clashes with the requested target tone.

Examples:
Window: "I put the keys their and left. Then we ate lunch at" -> proposals: [{"original":"their","occurrence":1,"alternatives":["there"],"reason":"place, not possessive"}]
Window: "The team have decided to ship on Friday because" -> proposals: [] (both 'have' and 'has' are acceptable in British English)
Window: "She is more taller then me, and she" -> proposals: [{"original":"then","occurrence":1,"alternatives":["than"],"reason":"comparison"}]
Window: "Vi skal huske og købe mælk når vi" -> proposals: [{"original":"og","occurrence":1,"alternatives":["at"],"reason":"infinitive marker before verb"}]
Window: "He made a big affect on the team, and everyone" -> proposals: [{"original":"affect","occurrence":1,"alternatives":["effect","impact"],"reason":"noun needed"}]
Window: "The weather was nice so we walked to the" -> proposals: []

ANTI-SLOP RULES (from rules/anti-slop-ruleset.md). Human writing must stay human.
Never propose any of these words as a replacement, in any inflection, even when they seem to fit:
${NEVER_SUGGEST_PROMPT}
Danish: ${NEVER_SUGGEST_DA_PROMPT}
Never "fix" these human features unless a target tone explicitly asks for it:
${PRESERVE_PROMPT}
Prefer the plain, concrete, everyday word over the ornate one. A replacement must be at least as short and at least as common as the original unless correctness demands otherwise.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["proposals"],
  properties: {
    proposals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["original", "occurrence", "alternatives", "reason", "category"],
        properties: {
          original: { type: "string" },
          occurrence: { type: "integer" },
          alternatives: { type: "array", items: { type: "string" } },
          reason: { type: "string" },
          category: { type: "string", enum: ["error", "tone"] },
        },
      },
    },
  },
} as const;

const TONE_GUIDE: Record<string, string> = {
  neutral: "Target tone: neutral. Also propose a plainer word for a single word that is slang, jargon, or emotionally loaded.",
  formal: "Target tone: formal. Also propose a replacement for a single word that is slang, a casual intensifier, or a contraction (e.g. 'gonna' -> 'going to', 'kids' -> 'children').",
  professional: "Target tone: professional. Also propose a replacement for a single word that is slang, vague filler, or overly casual in a workplace context.",
  casual: "Target tone: casual. Also propose a replacement for a single word that is stiff or bureaucratic where an everyday word exists (e.g. 'utilize' -> 'use', 'commence' -> 'start').",
  friendly: "Target tone: friendly. Also propose a warmer everyday word for a single word that is cold or bureaucratic.",
  academic: "Target tone: academic. Also propose a precise term for a single word that is colloquial, vague, or an unhedged absolute.",
  concise: "Target tone: concise. Also propose the shorter, plainer word for a single word that is needlessly long or ornate (e.g. 'utilize' -> 'use', 'approximately' -> 'about').",
};

const TONE_MODE = `TONE MODE: a target tone is set, so be assertive about register. Besides errors, propose a replacement for EVERY word or short phrase (up to 3 words) that a careful editor would change to fit the tone: slang, casual intensifiers, vague fillers (stuff, things, a lot, a bunch of), contractions when the tone is formal, stiff or bureaucratic words when the tone is casual or friendly, needlessly long words when the tone is concise. Up to 5 proposals. Each proposal is still a single replacement span: "original" is the exact words in the window (1-3 words) and the alternative is the phrase that replaces them. Do not change names, quotes, numbers, or the last two words.`;

/** Output format: constrained JSON schema (guaranteed shape, slower) or plain JSON asked for in the prompt (faster). */
export type HaikuFormat = "schema" | "free";
export async function proposeImprovements(window: string, lang: string, tone = "as-written", timeoutMs = 6000, paused = false, format: HaikuFormat = (process.env.HAIKU_FORMAT as HaikuFormat) || "free"): Promise<Proposal[]> {
  if (!anthropicConfigured()) throw new HaikuError("ANTHROPIC_API_KEY is not set", 503);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": anthropicKey(),
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: tone === "as-written" ? 400 : 700,
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: `${TONE_GUIDE[tone] ? TONE_GUIDE[tone] + "\n" + TONE_MODE + "\n" : ""}${paused ? "The writer has paused, so the window is complete: the last two words may be proposed as well.\n" : ""}Language: ${lang}\nWindow:\n${window}${format === "free" ? '\n\nAnswer with JSON only, no prose: {"proposals":[{"original":"","occurrence":1,"alternatives":[""],"reason":"","category":"error"}]}' : ""}` }],
        ...(format === "schema" ? { output_config: { format: { type: "json_schema", schema: SCHEMA } } } : {}),
      }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new HaikuError(`Anthropic HTTP ${res.status}`, res.status, json);
    if (json.stop_reason === "refusal") return [];
    if (json.stop_reason === "max_tokens") console.warn("propose: output truncated at max_tokens");
    const content = (json.content as Array<{ type: string; text?: string }>) ?? [];
    const text = content.find((c) => c.type === "text")?.text ?? "";
    let parsed: { proposals?: unknown } = {};
    try {
      // Plain-JSON mode may wrap the object in a code fence or a sentence; take the outermost braces.
      const m = /\{[\s\S]*\}/.exec(text);
      parsed = JSON.parse(m ? m[0] : text);
    } catch {
      return [];
    }
    const list = Array.isArray(parsed.proposals) ? parsed.proposals : [];
    return list
      .filter((p): p is Proposal => !!p && typeof p === "object" && typeof (p as Proposal).original === "string")
      .map((p) => ({
        original: p.original.trim(),
        occurrence: Math.max(1, Math.floor(Number(p.occurrence) || 1)),
        alternatives: (Array.isArray(p.alternatives) ? p.alternatives : []).map(String).map((s) => s.trim()).filter(Boolean).slice(0, 3),
        reason: String(p.reason ?? "").replace(/[{}\[\]"]+[\s\S]*$/, "").trim().slice(0, 120),
        category: ((p as Proposal).category === "tone" ? "tone" : "error") as "error" | "tone",
      }))
      .filter((p) => p.alternatives.length > 0 && !p.alternatives.includes(p.original) && p.original.split(/\s+/).length <= 3)
      .slice(0, tone === "as-written" ? 3 : 5);
  } finally {
    clearTimeout(t);
  }
}

const LANG_NAME: Record<string, string> = { en: "English", da: "Danish" };

/** Translate a single word the writer typed in the other language into the document language, in context. */
export async function translateWord(word: string, from: string, to: string, left: string, timeoutMs = 5000): Promise<{ translation: string; foreign: boolean }> {
  if (!anthropicConfigured()) throw new HaikuError("ANTHROPIC_API_KEY is not set", 503);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": anthropicKey(), "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 100,
        system: `The writer is writing in ${LANG_NAME[to] ?? to} but just typed a ${LANG_NAME[from] ?? from} word. Give the most natural ${LANG_NAME[to] ?? to} translation of that word as it is used in this context: one to three words, same part of speech, no explanation. If the typed word is a proper name, a brand, or not really a ${LANG_NAME[from] ?? from} word, set is_foreign_word to false.`,
        messages: [{ role: "user", content: `Context so far: ${left.slice(-300)}\nTyped word: ${word}` }],
        output_config: { format: { type: "json_schema", schema: { type: "object", additionalProperties: false, required: ["translation", "is_foreign_word"], properties: { translation: { type: "string" }, is_foreign_word: { type: "boolean" } } } } },
      }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new HaikuError(`Anthropic HTTP ${res.status}`, res.status, json);
    const content = (json.content as Array<{ type: string; text?: string }>) ?? [];
    const text = content.find((c) => c.type === "text")?.text ?? "{}";
    const parsed = JSON.parse(text) as { translation?: string; is_foreign_word?: boolean };
    return { translation: String(parsed.translation ?? "").trim(), foreign: parsed.is_foreign_word !== false };
  } finally {
    clearTimeout(t);
  }
}
