// Pure text helpers shared by client and server. No side effects.

export type Lang = "en" | "da";
export type Span = { start: number; end: number; word: string };

const WORD_CHAR = /[\p{L}\p{M}\p{N}'’\-]/u;

export function isWordChar(ch: string | undefined): boolean {
  return !!ch && WORD_CHAR.test(ch);
}

/** The word that ends exactly at `end` (exclusive). */
export function wordEndingAt(text: string, end: number): Span | null {
  if (end <= 0 || !isWordChar(text[end - 1])) return null;
  let start = end;
  while (start > 0 && isWordChar(text[start - 1])) start--;
  return { start, end, word: text.slice(start, end) };
}

/** The word that contains index `i`, if any. */
export function wordAt(text: string, i: number): Span | null {
  if (!isWordChar(text[i])) return null;
  let start = i;
  let end = i;
  while (start > 0 && isWordChar(text[start - 1])) start--;
  while (end < text.length && isWordChar(text[end])) end++;
  return { start, end, word: text.slice(start, end) };
}

/** Up to n words that end before `index`, nearest last. */
export function wordsBefore(text: string, index: number, n: number): Span[] {
  const out: Span[] = [];
  let i = index;
  while (out.length < n && i > 0) {
    while (i > 0 && !isWordChar(text[i - 1])) i--;
    const w = wordEndingAt(text, i);
    if (!w) break;
    out.unshift(w);
    i = w.start;
  }
  return out;
}

/** Words that should never be corrected by any pass. */
export function shouldSkip(word: string): boolean {
  if (word.length < 2) return true;
  if (/^[\p{Lu}\p{N}\-']+$/u.test(word) && word.length > 1 && /\p{Lu}/u.test(word)) return true; // ALL CAPS
  if (/\p{N}/u.test(word)) return true; // digits
  if (/^(https?:|www\.|[\w.-]+@[\w.-]+)/i.test(word)) return true;
  if (/[_\\/]/.test(word)) return true; // code-ish
  return false;
}

/** Copy the casing pattern of `original` onto `replacement`. */
export function transferCase(original: string, replacement: string): string {
  if (original === original.toUpperCase() && /\p{L}/u.test(original) && original.length > 1) {
    return replacement.toUpperCase();
  }
  const first = original[0];
  if (first && first === first.toUpperCase() && first !== first.toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/** Homophones / confusables that are only decidable with right-context. */
export const CONFUSABLES: Record<Lang, Record<string, string[]>> = {
  en: {
    their: ["there", "they're"], there: ["their", "they're"], "they're": ["their", "there"],
    its: ["it's"], "it's": ["its"],
    then: ["than"], than: ["then"],
    to: ["too"], too: ["to"],
    affect: ["effect"], effect: ["affect"],
    lose: ["loose"], loose: ["lose"],
    your: ["you're"], "you're": ["your"],
    whose: ["who's"], "who's": ["whose"],
    accept: ["except"], except: ["accept"],
    advice: ["advise"], advise: ["advice"],
    weather: ["whether"], whether: ["weather"],
    principal: ["principle"], principle: ["principal"],
    complement: ["compliment"], compliment: ["complement"],
    were: ["where", "we're"], where: ["were", "we're"],
    of: ["off", "have"], off: ["of"],
    quite: ["quiet"], quiet: ["quite"],
    passed: ["past"], past: ["passed"],
    piece: ["peace"], peace: ["piece"],
    brake: ["break"], break: ["brake"],
    hole: ["whole"], whole: ["hole"],
    write: ["right"], right: ["write"],
    weak: ["week"], week: ["weak"],
    bare: ["bear"], bear: ["bare"],
    site: ["sight", "cite"], sight: ["site"],
    role: ["roll"], roll: ["role"],
    desert: ["dessert"], dessert: ["desert"],
    led: ["lead"], lead: ["led"],
    allowed: ["aloud"], aloud: ["allowed"],
    council: ["counsel"], counsel: ["council"],
    stationary: ["stationery"], stationery: ["stationary"],
  },
  da: {
    og: ["at"], at: ["og"],
    af: ["ad"], ad: ["af"],
    nogen: ["nogle"], nogle: ["nogen"],
    ligge: ["lægge"], lægge: ["ligge"],
    sin: ["hans", "hendes"], hans: ["sin"], hendes: ["sin"],
    sit: ["hans", "hendes"],
    ligger: ["lægger"], lægger: ["ligger"],
    hver: ["vær"], vær: ["hver"],
    end: ["en"],
  },
};

const DA_MARKERS = new Set(["og", "at", "det", "er", "jeg", "ikke", "til", "af", "en", "på", "med", "som", "den", "for", "har", "kan", "vi", "du", "de", "skal", "være", "også", "eller", "men", "hvad", "når", "over", "her", "fra", "meget"]);
const EN_MARKERS = new Set(["the", "and", "is", "are", "to", "of", "in", "it", "that", "was", "for", "on", "with", "as", "this", "have", "be", "not", "you", "we", "they", "but", "or", "what", "when", "from", "very", "there", "will"]);

export function detectLang(text: string): Lang {
  let da = 0;
  let en = 0;
  for (const w of text.toLowerCase().split(/[^\p{L}]+/u)) {
    if (DA_MARKERS.has(w)) da++;
    if (EN_MARKERS.has(w)) en++;
  }
  if (/[æøå]/i.test(text)) da += 2;
  return da > en ? "da" : "en";
}

/** Last two complete sentences plus the current one, ending at `caret`. */
export function windowBefore(text: string, caret: number, maxChars = 700): { start: number; text: string } {
  const upto = text.slice(0, caret);
  const ends: number[] = [];
  const re = /[.!?]\s|\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(upto))) ends.push(m.index + m[0].length);
  let start = ends.length >= 3 ? ends[ends.length - 3] : 0;
  if (caret - start > maxChars) start = caret - maxChars;
  return { start, text: upto.slice(start) };
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Index of the k-th (1-based) whole-word occurrence of `word` in `text`, or -1. */
export function nthWordOccurrence(text: string, word: string, k: number): number {
  const re = new RegExp(`(?<![\\p{L}\\p{N}'’\\-])${escapeRegExp(word)}(?![\\p{L}\\p{N}'’\\-])`, "gu");
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    n++;
    if (n === k) return m.index;
    if (m[0].length === 0) re.lastIndex++;
  }
  return -1;
}

/** Optimal string alignment distance: a transposition counts as one edit. */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Unambiguous, very common typos. Fixed locally with no API call. */
export const COMMON_TYPOS: Record<Lang, Record<string, string>> = {
  en: {
    teh: "the", hte: "the", adn: "and", nad: "and", taht: "that", thier: "their", recieve: "receive", recieved: "received",
    seperate: "separate", definately: "definitely", occured: "occurred", untill: "until", wich: "which", becuase: "because",
    freind: "friend", beleive: "believe", acheive: "achieve", accomodate: "accommodate", occassion: "occasion", tommorow: "tomorrow",
    truely: "truly", wierd: "weird", goverment: "government", enviroment: "environment", neccessary: "necessary", occurence: "occurrence",
    publically: "publicly", recomend: "recommend", refered: "referred", succesful: "successful", tounge: "tongue", writting: "writing",
    yuo: "you", jsut: "just", waht: "what", whihc: "which", wiht: "with", thsi: "this", tihs: "this", dont: "don't", doesnt: "doesn't",
    didnt: "didn't", cant: "can't", wont: "won't", isnt: "isn't", wasnt: "wasn't", havent: "haven't", im: "I'm", ive: "I've",
  },
  da: {
    ogsaa: "også", hvordn: "hvordan", igår: "i går", idag: "i dag", imorgen: "i morgen", iøvrigt: "i øvrigt", istedet: "i stedet",
    intresant: "interessant", intressant: "interessant", interesant: "interessant",
    resturant: "restaurant", mellom: "mellem", virkeligt: "virkelig",
  },
};

