// Pass A: typo fix for the word just committed. Local Hunspell candidates, Jev picks.
import { NextResponse } from "next/server";
import { getSpeller } from "@/lib/spell";
import { resolveLang } from "@/lib/lang";
import { inFrequencyList } from "@/lib/freq";
import { logEvent, scrub } from "@/lib/log";
import { jevConfigured, jevDecide, JevError, jevLimited } from "@/lib/jev";
import { anthropicConfigured, translateWord } from "@/lib/haiku";
import { thresholds } from "@/lib/thresholds";
import { COMMON_TYPOS, editDistance, shouldSkip, transferCase, type Lang } from "@/lib/text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { word: string; left: string; doc?: string; lang?: Lang | "auto"; aggressiveness?: number; translate?: boolean };

export async function POST(req: Request) {
  const t0 = Date.now();
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const word = String(body.word ?? "").trim();
  const left = String(body.left ?? "").slice(-400);
  const T = thresholds(body.aggressiveness ?? 0.5);
  if (!word || shouldSkip(word)) return NextResponse.json({ replace: false, why: "skipped" });

  // Document language: explicit from settings, otherwise the dictionary that most recent words belong to.
  const resolved = await resolveLang(body.lang, left, typeof body.doc === "string" ? body.doc.slice(0, 20000) : undefined);
  const lang: Lang = resolved.lang;
  const detected = resolved.detected;
  const canTranslate = body.translate !== false && resolved.conclusive;

  const bare = word.replace(/^['’]+|['’]+$/g, "");
  const common = COMMON_TYPOS[lang][bare.toLowerCase()];
  if (common) return NextResponse.json({ replace: true, to: transferCase(word, common), confidence: 0.99, source: "table", why: "common_typo", ms: Date.now() - t0 });

  const speller = await getSpeller(lang);
  if (!bare || speller.correct(bare) || speller.correct(bare.toLowerCase())) {
    return NextResponse.json({ replace: false, why: "known", lang, detected, ms: Date.now() - t0 });
  }
  // Translation: the document language was chosen explicitly and the word belongs to the other language.
  let trNote = canTranslate ? "" : "translation_off";
  if (canTranslate && anthropicConfigured()) {
    const other: Lang = lang === "en" ? "da" : "en";
    let isForeign = bare.length >= 2 && (await inFrequencyList(bare.toLowerCase(), other));
    if (!isForeign && bare.length >= 2 && (other === "da" ? /[æøå]/i.test(bare) : true)) {
      const otherSpeller = await getSpeller(other);
      isForeign = otherSpeller.correct(bare) || otherSpeller.correct(bare.toLowerCase());
    }
    if (isForeign) {
      try {
        const tr = await translateWord(bare, other, lang, left);
        trNote = `haiku: ${JSON.stringify(tr)}`;
        // "for the kunden" -> Haiku says "the customer": drop the article the writer already typed.
        const lastLeft = (left.match(/([\p{L}'’]+)\s*$/u)?.[1] ?? "").toLowerCase();
        const firstTr = tr.translation.split(/\s+/)[0]?.toLowerCase();
        if (lastLeft && firstTr === lastLeft && tr.translation.includes(" ")) tr.translation = tr.translation.split(/\s+/).slice(1).join(" ");
        if (tr.foreign && tr.translation && tr.translation.toLowerCase() !== bare.toLowerCase() && tr.translation.split(/\s+/).length <= 3) {
          let confidence = 0.9;
          let source = "haiku";
          if (jevConfigured() && !jevLimited()) {
            try {
            source = "haiku+jev";
            const g = await jevDecide(
              { task: `The writer is writing in ${lang} and typed a ${other} word. Decide whether replacing it with the translation is what the writer wants.`, language: lang, left_context: left, typed_word: bare, translation: tr.translation },
              { action: { type: "choice", instructions: "Which is right for this document?", criteria: { keep: `Keep "${bare}" (it is a name, a quotation, or intended in ${other}).`, translate: `Replace with "${tr.translation}".` } } },
            );
            if (g.action.choice !== "translate") return NextResponse.json({ replace: false, why: "translation_rejected", ms: Date.now() - t0 });
            confidence = g.action.confidence ?? 0.8;
            } catch (e) {
              // Jev unavailable: rely on Haiku's own judgement at reduced confidence.
              trNote += ` | jev_gate_error: ${(e as Error).message.slice(0, 80)}`;
              confidence = 0.8;
              source = "haiku";
            }
          }
          if (confidence >= T.typo) {
            logEvent({ route: "decide", kind: "translate", ms: Date.now() - t0, lang, in: { word: scrub(word), left: scrub(left).slice(-80) }, out: { to: tr.translation, confidence, source } });
            return NextResponse.json({ replace: true, to: transferCase(word, tr.translation), confidence, kind: "translate", source, lang, detected, trNote, ms: Date.now() - t0 });
          }
          return NextResponse.json({ replace: false, why: "translation_low_confidence", confidence, ms: Date.now() - t0 });
        }
      } catch (e) {
        trNote = `translate_error: ${(e as Error).message}`;
      }
    } else trNote = `not_in_${other}_dictionary`;
  }

  const suggestions = uniq(
    speller
      .suggest(bare)
      .map((s) => s.trim())
      .filter((s) => s && s.toLowerCase() !== bare.toLowerCase() && !/\s/.test(s)),
  ).slice(0, 5);
  if (suggestions.length === 0) return NextResponse.json({ replace: false, why: "no_candidates", lang, detected, trNote, ms: Date.now() - t0 });

  // Local-only fallback when Jev is not configured: exactly one candidate within one edit, and it is the top suggestion.
  if (!jevConfigured()) {
    const close = suggestions.filter((s) => editDistance(s.toLowerCase(), bare.toLowerCase()) <= 1);
    if (close.length === 1 && close[0] === suggestions[0] && bare.length >= 4) {
      return NextResponse.json({ replace: true, to: transferCase(word, close[0]), confidence: 0.7, source: "local", why: "single_close_candidate", ms: Date.now() - t0 });
    }
    return NextResponse.json({ replace: false, why: "jev_not_configured", missing: ["JEV_API_KEY"], ms: Date.now() - t0 });
  }

  const criteria: Record<string, string> = { keep_as_typed: `Keep "${bare}" exactly as typed.` };
  suggestions.forEach((s, i) => (criteria[`opt_${i}`] = `Replace with "${s}".`));
  try {
    const ans = await jevDecide(
      {
        task: "Inline autocorrect while the user is typing. The typed word is not in the dictionary. Decide whether it is a typo and, if so, which candidate the writer meant.",
        language: lang,
        left_context: left,
        typed_word: bare,
        candidates: suggestions,
      },
      {
        intentional: { type: "noul", instructions: "Is the typed word intended as written, e.g. a proper name, slang, jargon, a word from another language, or a deliberate spelling? Answer yes only if it is clearly intentional." },
        fix: { type: "choice", instructions: "Which option best matches what the writer meant, given the left context? Prefer keep_as_typed unless a candidate is clearly the intended word.", criteria },
      },
    );
    const intentional = ans.intentional.noul ?? 0;
    const choice = ans.fix.choice ?? "keep_as_typed";
    const confidence = ans.fix.confidence ?? 0;
    const idx = /^opt_(\d+)$/.exec(choice);
    const to = idx ? suggestions[Number(idx[1])] : undefined;
    const replace = !!to && intentional < T.intentional && confidence >= T.typo;
    return NextResponse.json({
      replace,
      to: replace && to ? transferCase(word, to) : undefined,
      confidence,
      intentional,
      candidates: suggestions,
      source: "jev",
      lang,
      detected,
      ms: Date.now() - t0,
    });
  } catch (e) {
    const err = e as JevError;
    return NextResponse.json({ replace: false, why: "jev_error", detail: err.message, status: err.status ?? 502, ms: Date.now() - t0 }, { status: err.status === 429 ? 429 : err.status === 503 ? 503 : 200 });
  }
}

function uniq(a: string[]): string[] {
  const seen = new Set<string>();
  return a.filter((s) => (seen.has(s.toLowerCase()) ? false : (seen.add(s.toLowerCase()), true)));
}
