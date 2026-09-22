// Texting abbreviations and dropped-apostrophe forms that every client expands instantly, served together with the
// learned library so web, desktop and Android share one table. Only forms that are not words in their own right.
import type { LibraryEntry } from "./library";

const EN: Record<string, string> = {
  rdy: "ready", pls: "please", plz: "please", thx: "thanks", thnx: "thanks", ty: "thank you", tmrw: "tomorrow", tmr: "tomorrow", tmw: "tomorrow",
  tho: "though", thru: "through", cuz: "because", coz: "because", bc: "because", bcs: "because", idk: "I don't know", idc: "I don't care",
  imo: "in my opinion", imho: "in my opinion", btw: "by the way", omw: "on my way", brb: "be right back", ttyl: "talk to you later", gr8: "great",
  l8r: "later", msg: "message", msgs: "messages", ppl: "people", nvm: "never mind", np: "no problem", bday: "birthday", congrats: "congratulations",
  dunno: "don't know", ur: "your", yr: "your", abt: "about", w8: "wait", b4: "before", "2day": "today", "2nite": "tonight", "2moro": "tomorrow", srsly: "seriously",
  probs: "probably", prolly: "probably", def: "definitely", obv: "obviously", atm: "at the moment", rn: "right now", tbh: "to be honest", ofc: "of course",
  fyi: "for your information", nbd: "no big deal", wyd: "what are you doing", hbu: "how about you", wbu: "what about you", ily: "I love you", jk: "just kidding",
  im: "I'm", ive: "I've", youre: "you're", youve: "you've", youll: "you'll", theyre: "they're", theyve: "they've", weve: "we've", thats: "that's", whats: "what's",
  hes: "he's", shes: "she's", isnt: "isn't", wasnt: "wasn't", werent: "weren't", arent: "aren't", didnt: "didn't", doesnt: "doesn't", couldnt: "couldn't",
  wouldnt: "wouldn't", shouldnt: "shouldn't", havent: "haven't", hasnt: "hasn't", hadnt: "hadn't", wont: "won't", cant: "can't", dont: "don't", aint: "isn't",
};
const DA: Record<string, string> = {
  ik: "ikke", ikk: "ikke", oxo: "også", osse: "også", ku: "kunne", sku: "skulle", ka: "kan", hva: "hvad", kbh: "København", tlf: "telefon",
  mvh: "med venlig hilsen", hvsl: "hvis", ig: "igen", mgt: "meget", mgl: "mangler", nsv: "nogensinde", sg: "søger", vh: "venlig hilsen", flg: "følgende",
  gd: "god", gm: "godmorgen", gn: "godnat", asa: "altså", altsaa: "altså", ogsaa: "også", saa: "så", naar: "når", foer: "før", laenge: "længe",
};

export const ABBREVIATIONS: Record<string, LibraryEntry> = Object.fromEntries([
  ...Object.entries(EN).map(([k, to]) => [k, { to, n: 0, lang: "en", note: "abbreviation" }]),
  ...Object.entries(DA).map(([k, to]) => [k, { to, n: 0, lang: "da", note: "abbreviation" }]),
]);
