// Word-frequency lists (hermitdave/FrequencyWords, OpenSubtitles 2018, CC BY-SA 4.0) for prefix completion.
import fs from "node:fs/promises";
import path from "node:path";
import type { Lang } from "./text";

type Entry = { word: string; count: number };
const cache: Partial<Record<Lang, Promise<Entry[]>>> = {};
const dicCache: Partial<Record<Lang, Promise<string[]>>> = {};

/** Base words from the Hunspell .dic file (no frequencies), sorted, for prefixes the 50k list misses. */
function loadDic(lang: Lang): Promise<string[]> {
  if (!dicCache[lang]) {
    dicCache[lang] = (async () => {
      const mod = lang === "da" ? await import("dictionary-da") : await import("dictionary-en");
      const dic = Buffer.from((mod.default as { dic: Uint8Array }).dic).toString("utf8");
      const words = new Set<string>();
      for (const line of dic.split("\n")) {
        const w = line.split("/")[0].trim();
        if (w.length >= 4 && /^[\p{Ll}][\p{Ll}'’-]+$/u.test(w)) words.add(w);
      }
      return [...words].sort();
    })();
  }
  return dicCache[lang] as Promise<string[]>;
}

function lowerBound(list: string[], p: string): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < p) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function load(lang: Lang): Promise<Entry[]> {
  if (!cache[lang]) {
    cache[lang] = (async () => {
      const file = path.join(process.cwd(), "data", `${lang}_50k.txt`);
      const text = await fs.readFile(file, "utf8");
      const entries: Entry[] = [];
      for (const line of text.split("\n")) {
        const sp = line.indexOf(" ");
        if (sp <= 0) continue;
        const word = line.slice(0, sp);
        if (!/^[\p{L}'’-]+$/u.test(word)) continue;
        entries.push({ word, count: Number(line.slice(sp + 1)) || 0 });
      }
      entries.sort((a, b) => (a.word < b.word ? -1 : a.word > b.word ? 1 : 0));
      return entries;
    })();
  }
  return cache[lang] as Promise<Entry[]>;
}

/** Most frequent words starting with `prefix` (case-insensitive), longest-first ties broken by frequency. */
export async function completions(prefix: string, lang: Lang, limit = 8): Promise<{ word: string; count: number }[]> {
  const list = await load(lang);
  const p = prefix.toLowerCase();
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].word < p) lo = mid + 1;
    else hi = mid;
  }
  const out: Entry[] = [];
  for (let i = lo; i < list.length && list[i].word.startsWith(p); i++) {
    if (list[i].word.length >= p.length + 2) out.push(list[i]);
  }
  out.sort((a, b) => b.count - a.count);
  const top = out.slice(0, limit);
  // Fill up with dictionary base words the frequency list does not know (longer, rarer words).
  if (top.length < limit) {
    const dic = await loadDic(lang);
    const seen = new Set(top.map((e) => e.word));
    for (let i = lowerBound(dic, p); i < dic.length && dic[i].startsWith(p) && top.length < limit; i++) {
      if (dic[i].length >= p.length + 2 && !seen.has(dic[i])) top.push({ word: dic[i], count: 0 });
    }
  }
  return top;
}

export async function frequency(word: string, lang: Lang): Promise<number> {
  const list = await load(lang);
  const w = word.toLowerCase();
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].word < w) lo = mid + 1;
    else hi = mid;
  }
  return lo < list.length && list[lo].word === w ? list[lo].count : 0;
}

/** Fast membership test against the 50k frequency list (no Hunspell parse needed). */
export async function inFrequencyList(word: string, lang: Lang): Promise<boolean> {
  return (await frequency(word, lang)) > 0;
}
