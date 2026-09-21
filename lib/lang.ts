// Resolve the document language for a request: explicit setting, else per-paragraph dictionary count,
// else whole-context dictionary count, else the marker-word heuristic.
import { detectLangByDictionary } from "./spell";
import { detectLang, type Lang } from "./text";

export type Detected = { lang: Lang | null; en: number; da: number };

// Auto mode counts every word on the page (the client sends the whole document as `doc`).
export async function resolveLang(bodyLang: unknown, left: string, doc?: string): Promise<{ lang: Lang; detected: Detected | null; conclusive: boolean }> {
  if (bodyLang === "da" || bodyLang === "en") return { lang: bodyLang, detected: null, conclusive: true };
  const source = doc && doc.length > left.length ? doc : left;
  const detected = await detectLangByDictionary(source, 4000);
  if (detected.lang) return { lang: detected.lang, detected, conclusive: true };
  return { lang: detectLang(source), detected, conclusive: false };
}
