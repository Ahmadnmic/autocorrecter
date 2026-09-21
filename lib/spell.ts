// Server-only Hunspell candidates via nspell. Dictionaries are loaded once per instance.
import nspell from "nspell";
import type { Lang } from "./text";

type Speller = ReturnType<typeof nspell>;
const cache: Partial<Record<Lang, Promise<Speller>>> = {};

export function getSpeller(lang: Lang): Promise<Speller> {
  if (!cache[lang]) {
    cache[lang] = (async () => {
      const mod = lang === "da" ? await import("dictionary-da") : await import("dictionary-en");
      const dict = mod.default as { aff: Uint8Array; dic: Uint8Array };
      return nspell({ aff: Buffer.from(dict.aff), dic: Buffer.from(dict.dic) });
    })();
  }
  return cache[lang] as Promise<Speller>;
}

/** Decide the document language by counting words that belong to exactly one dictionary.
 *  The Danish dictionary (1 s to parse on a cold instance) is loaded only when the text shows signs of Danish. */
export async function detectLangByDictionary(text: string, maxWords = 80): Promise<{ lang: Lang | null; en: number; da: number }> {
  const words = text.split(/[^\p{L}'’]+/u).filter((w) => w.length >= 2).slice(-maxWords);
  if (words.length < 4) return { lang: null, en: 0, da: 0 };
  const en = await getSpeller("en");
  const isEn = words.map((w) => en.correct(w) || en.correct(w.toLowerCase()));
  const unknownToEn = isEn.filter((x) => !x).length;
  const looksDanish = /[æøå]/i.test(text) || unknownToEn / words.length > 0.2;
  if (!looksDanish) return { lang: "en", en: isEn.filter(Boolean).length, da: 0 };
  const da = await getSpeller("da");
  let ne = 0;
  let nd = 0;
  words.forEach((w, i) => {
    const isDa = da.correct(w) || da.correct(w.toLowerCase());
    if (isEn[i] && !isDa) ne++;
    else if (isDa && !isEn[i]) nd++;
  });
  if (ne + nd < 4) return { lang: null, en: ne, da: nd };
  return { lang: nd > ne ? "da" : "en", en: ne, da: nd };
}
