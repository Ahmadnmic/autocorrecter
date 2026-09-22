// Two tables, served with the learned library so web, desktop and Android share them.
//   ABBREVIATIONS  dropped apostrophes and plain misspellings: always expanded, they are errors, not style.
//   SHORTHAND      texting shorthand (u, rdy, pls, tmrw): the writer chose it, so it is only expanded when the tone
//                  asks for it (formal, professional, academic, neutral). In as-written, casual, friendly and
//                  concise it stays exactly as typed.
import type { LibraryEntry } from "./library";

const EN_SHORT: Record<string, string> = {
  u: "you", ur: "your", yr: "your", r: "are", n: "and", y: "why", k: "okay", kk: "okay",
  rdy: "ready", pls: "please", plz: "please", thx: "thanks", thnx: "thanks", ty: "thank you", tmrw: "tomorrow", tmr: "tomorrow", tmw: "tomorrow",
  tho: "though", thru: "through", cuz: "because", coz: "because", bc: "because", bcs: "because", idk: "I don't know", idc: "I don't care",
  imo: "in my opinion", imho: "in my opinion", btw: "by the way", omw: "on my way", brb: "be right back", ttyl: "talk to you later", gr8: "great",
  l8r: "later", ppl: "people", nvm: "never mind", np: "no problem", bday: "birthday", 
  dunno: "don't know", abt: "about", w8: "wait", b4: "before", "2day": "today", "2nite": "tonight", "2moro": "tomorrow", srsly: "seriously",
  probs: "probably", prolly: "probably", def: "definitely", obv: "obviously", atm: "at the moment", rn: "right now", tbh: "to be honest", ofc: "of course",
  fyi: "for your information", nbd: "no big deal", wyd: "what are you doing", hbu: "how about you", wbu: "what about you", ily: "I love you", jk: "just kidding",
};
const EN_ALWAYS: Record<string, string> = {
  im: "I'm", ive: "I've", youre: "you're", youve: "you've", youll: "you'll", theyre: "they're", theyve: "they've", weve: "we've", thats: "that's",
  whats: "what's", hes: "he's", shes: "she's", isnt: "isn't", wasnt: "wasn't", werent: "weren't", arent: "aren't", didnt: "didn't", doesnt: "doesn't",
  couldnt: "couldn't", wouldnt: "wouldn't", shouldnt: "shouldn't", havent: "haven't", hasnt: "hasn't", hadnt: "hadn't", wont: "won't", cant: "can't",
  dont: "don't", aint: "isn't", congrats: "congratulations", msg: "message", msgs: "messages", recieve: "receive",
};
const DA_SHORT: Record<string, string> = {
  ik: "ikke", ikk: "ikke", oxo: "også", osse: "også", ku: "kunne", sku: "skulle", ka: "kan", hva: "hvad", kbh: "København", tlf: "telefon",
  mvh: "med venlig hilsen", hvsl: "hvis", ig: "igen", mgt: "meget", mgl: "mangler", nsv: "nogensinde", sg: "søger", vh: "venlig hilsen", flg: "følgende",
  gd: "god", gm: "godmorgen", gn: "godnat", asa: "altså", altsaa: "altså", ogsaa: "også", saa: "så", naar: "når", foer: "før", laenge: "længe",
};

const entry = (lang: string, note: string) => ([k, to]: [string, string]) => [k, { to, n: 0, lang, note }] as const;

/** Always applied: dropped apostrophes and misspellings. */
export const ABBREVIATIONS: Record<string, LibraryEntry> = Object.fromEntries([...Object.entries(EN_ALWAYS).map(entry("en", "contraction"))]);

/** Applied only when the tone asks for it. */
export const SHORTHAND: Record<string, LibraryEntry> = Object.fromEntries([
  ...Object.entries(EN_SHORT).map(entry("en", "shorthand")),
  ...Object.entries(DA_SHORT).map(entry("da", "shorthand")),
]);

/** Tones that spell shorthand out. In the others the writer's own shorthand stands. */
export const EXPANDS_SHORTHAND = new Set(["formal", "professional", "academic", "neutral"]);
export const expandsShorthand = (tone: unknown): boolean => typeof tone === "string" && EXPANDS_SHORTHAND.has(tone);
