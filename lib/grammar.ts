// Instant, local punctuation and spacing fixes applied as the user types. No API calls.
// Each fix is a small replacement near the caret; the caller applies it and logs it as a "grammar" change.

export type GrammarFix = { start: number; end: number; to: string; note: string };

const ABBREV = new Set(["e.g", "i.e", "etc", "vs", "mr", "mrs", "ms", "dr", "prof", "st", "no", "ca", "fx", "bl.a", "osv", "dvs", "evt", "mv", "jf", "pga", "ifm", "hhv", "inkl", "ekskl", "ca", "kl", "nr"]);

/** Given the text after a single typed character at index `p` (so text[p] is the new char), return a fix or null. */
export function grammarFix(text: string, p: number, lang: "en" | "da" = "en"): GrammarFix | null {
  const ch = text[p];
  const prev = text[p - 1];
  const prev2 = text[p - 2];

  // 0. English pronoun "i" on its own -> "I" (checked when the following boundary is typed).
  if (lang === "en" && !isWordCharLocal(ch) && prev === "i" && !isWordCharLocal(prev2) && !(prev2 === "'" || prev2 === "’")) {
    return { start: p - 1, end: p, to: "I", note: "pronoun I" };
  }

  // 1. Double space -> single space.
  if (ch === " " && prev === " ") return { start: p, end: p + 1, to: "", note: "double space" };

  // 2. Space before closing punctuation: "word ," -> "word,"
  if (/[,.;:!?)]/.test(ch) && prev === " " && p >= 2 && /[\p{L}\p{N})"'’”]/u.test(prev2 ?? "")) {
    if (!(ch === "." && /\p{N}/u.test(prev2 ?? ""))) return { start: p - 1, end: p, to: "", note: `space before ${ch}` };
  }

  // 3. Space after opening bracket or opening quote: "( word" -> "(word", "\" word" -> "\"word"
  if (ch === " " && prev === "(") return { start: p, end: p + 1, to: "", note: "space after (" };
  if (ch === " " && prev === '"' && quoteIsOpening(text, p - 1)) return { start: p, end: p + 1, to: "", note: "space after opening quote" };

  // 4. Closing quote after a space: "word \"" -> "word\""
  if (ch === '"' && prev === " " && !quoteIsOpening(text, p) && p >= 2 && /[\p{L}\p{N}.,!?]/u.test(prev2 ?? "")) {
    return { start: p - 1, end: p, to: "", note: "space before closing quote" };
  }

  // 5. Missing space after , ; : ! ? . followed by a letter: "word,word" -> "word, word"
  if (/\p{L}/u.test(ch) && /[,;:!?.]/.test(prev ?? "")) {
    const before = text[p - 2] ?? "";
    if (/\p{L}/u.test(before)) {
      // not decimals/abbreviations/urls: "3.5", "e.g.", "example.com"
      const wordBefore = text.slice(0, p - 1).match(/[\p{L}.]+$/u)?.[0].toLowerCase() ?? "";
      const isUrlish = /\.(com|org|net|dk|io|co|app|ai)$/i.test(wordBefore + "." + ch) || /^(www|http)/i.test(wordBefore);
      if (prev === "." && (ABBREV.has(wordBefore.replace(/\.$/, "")) || wordBefore.length <= 2 || isUrlish)) return null;
      if (prev !== "." || wordBefore.length > 2) return { start: p, end: p, to: " ", note: `space after ${prev}` };
    }
  }

  // 6. Missing space after closing bracket before a letter: ")word" -> ") word"
  if (/\p{L}/u.test(ch) && prev === ")") return { start: p, end: p, to: " ", note: "space after )" };

  // 7. Missing space before an opening bracket: "word(" -> "word ("
  if (ch === "(" && /[\p{L}\p{N}]/u.test(prev ?? "")) return { start: p, end: p, to: " ", note: "space before (" };

  // 8. Capital letter after sentence end: "end. word" -> "end. Word" (also first letter of a paragraph)
  if (/\p{Ll}/u.test(ch)) {
    const before = text.slice(0, p);
    const m = /([.!?])\s+$/.exec(before);
    if (m) {
      const wordBefore = before.slice(0, before.length - m[0].length).match(/[\p{L}.]+$/u)?.[0].toLowerCase() ?? "";
      if (m[1] !== "." || !(ABBREV.has(wordBefore) || wordBefore.length <= 1)) return { start: p, end: p + 1, to: ch.toUpperCase(), note: "capital after sentence end" };
    } else if (/^\s*$/.test(before) || /\n\s*$/.test(before)) {
      return { start: p, end: p + 1, to: ch.toUpperCase(), note: "capital at paragraph start" };
    }
  }

  // 9. Doubled comma or semicolon.
  if ((ch === "," && prev === ",") || (ch === ";" && prev === ";")) return { start: p, end: p + 1, to: "", note: `double ${ch}` };

  return null;
}

/** Whether the straight quote at index i opens a quotation (even number of quotes before it in the paragraph). */
function quoteIsOpening(text: string, i: number): boolean {
  const paraStart = text.lastIndexOf("\n", i - 1) + 1;
  let n = 0;
  for (let k = paraStart; k < i; k++) if (text[k] === '"') n++;
  return n % 2 === 0;
}

function isWordCharLocal(c: string | undefined): boolean {
  return !!c && /[\p{L}\p{M}\p{N}'’\-]/u.test(c);
}
