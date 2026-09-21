"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var text_exports = {};
__export(text_exports, {
  COMMON_TYPOS: () => COMMON_TYPOS,
  CONFUSABLES: () => CONFUSABLES,
  detectLang: () => detectLang,
  editDistance: () => editDistance,
  escapeRegExp: () => escapeRegExp,
  isWordChar: () => isWordChar,
  nthWordOccurrence: () => nthWordOccurrence,
  shouldSkip: () => shouldSkip,
  transferCase: () => transferCase,
  windowBefore: () => windowBefore,
  wordAt: () => wordAt,
  wordEndingAt: () => wordEndingAt,
  wordsBefore: () => wordsBefore
});
module.exports = __toCommonJS(text_exports);
const WORD_CHAR = /[\p{L}\p{M}\p{N}'’\-]/u;
function isWordChar(ch) {
  return !!ch && WORD_CHAR.test(ch);
}
function wordEndingAt(text, end) {
  if (end <= 0 || !isWordChar(text[end - 1])) return null;
  let start = end;
  while (start > 0 && isWordChar(text[start - 1])) start--;
  return { start, end, word: text.slice(start, end) };
}
function wordAt(text, i) {
  if (!isWordChar(text[i])) return null;
  let start = i;
  let end = i;
  while (start > 0 && isWordChar(text[start - 1])) start--;
  while (end < text.length && isWordChar(text[end])) end++;
  return { start, end, word: text.slice(start, end) };
}
function wordsBefore(text, index, n) {
  const out = [];
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
function shouldSkip(word) {
  if (word.length < 2) return true;
  if (/^[\p{Lu}\p{N}\-']+$/u.test(word) && word.length > 1 && /\p{Lu}/u.test(word)) return true;
  if (/\p{N}/u.test(word)) return true;
  if (/^(https?:|www\.|[\w.-]+@[\w.-]+)/i.test(word)) return true;
  if (/[_\\/]/.test(word)) return true;
  return false;
}
function transferCase(original, replacement) {
  if (original === original.toUpperCase() && /\p{L}/u.test(original) && original.length > 1) {
    return replacement.toUpperCase();
  }
  const first = original[0];
  if (first && first === first.toUpperCase() && first !== first.toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}
const CONFUSABLES = {
  en: {
    their: ["there", "they're"],
    there: ["their", "they're"],
    "they're": ["their", "there"],
    its: ["it's"],
    "it's": ["its"],
    then: ["than"],
    than: ["then"],
    to: ["too"],
    too: ["to"],
    affect: ["effect"],
    effect: ["affect"],
    lose: ["loose"],
    loose: ["lose"],
    your: ["you're"],
    "you're": ["your"],
    whose: ["who's"],
    "who's": ["whose"],
    accept: ["except"],
    except: ["accept"],
    advice: ["advise"],
    advise: ["advice"],
    weather: ["whether"],
    whether: ["weather"],
    principal: ["principle"],
    principle: ["principal"],
    complement: ["compliment"],
    compliment: ["complement"],
    were: ["where", "we're"],
    where: ["were", "we're"],
    of: ["off", "have"],
    off: ["of"],
    quite: ["quiet"],
    quiet: ["quite"],
    passed: ["past"],
    past: ["passed"],
    piece: ["peace"],
    peace: ["piece"],
    brake: ["break"],
    break: ["brake"],
    hole: ["whole"],
    whole: ["hole"],
    write: ["right"],
    right: ["write"],
    weak: ["week"],
    week: ["weak"],
    bare: ["bear"],
    bear: ["bare"],
    site: ["sight", "cite"],
    sight: ["site"],
    role: ["roll"],
    roll: ["role"],
    desert: ["dessert"],
    dessert: ["desert"],
    led: ["lead"],
    lead: ["led"],
    allowed: ["aloud"],
    aloud: ["allowed"],
    council: ["counsel"],
    counsel: ["council"],
    stationary: ["stationery"],
    stationery: ["stationary"]
  },
  da: {
    og: ["at"],
    at: ["og"],
    af: ["ad"],
    ad: ["af"],
    nogen: ["nogle"],
    nogle: ["nogen"],
    ligge: ["l\xE6gge"],
    l\u00E6gge: ["ligge"],
    sin: ["hans", "hendes"],
    hans: ["sin"],
    hendes: ["sin"],
    sit: ["hans", "hendes"],
    ligger: ["l\xE6gger"],
    l\u00E6gger: ["ligger"],
    hver: ["v\xE6r"],
    v\u00E6r: ["hver"],
    end: ["en"]
  }
};
const DA_MARKERS = /* @__PURE__ */ new Set(["og", "at", "det", "er", "jeg", "ikke", "til", "af", "en", "p\xE5", "med", "som", "den", "for", "har", "kan", "vi", "du", "de", "skal", "v\xE6re", "ogs\xE5", "eller", "men", "hvad", "n\xE5r", "over", "her", "fra", "meget"]);
const EN_MARKERS = /* @__PURE__ */ new Set(["the", "and", "is", "are", "to", "of", "in", "it", "that", "was", "for", "on", "with", "as", "this", "have", "be", "not", "you", "we", "they", "but", "or", "what", "when", "from", "very", "there", "will"]);
function detectLang(text) {
  let da = 0;
  let en = 0;
  for (const w of text.toLowerCase().split(/[^\p{L}]+/u)) {
    if (DA_MARKERS.has(w)) da++;
    if (EN_MARKERS.has(w)) en++;
  }
  if (/[æøå]/i.test(text)) da += 2;
  return da > en ? "da" : "en";
}
function windowBefore(text, caret, maxChars = 700) {
  const upto = text.slice(0, caret);
  const ends = [];
  const re = /[.!?]\s|\n/g;
  let m;
  while (m = re.exec(upto)) ends.push(m.index + m[0].length);
  let start = ends.length >= 3 ? ends[ends.length - 3] : 0;
  if (caret - start > maxChars) start = caret - maxChars;
  return { start, text: upto.slice(start) };
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function nthWordOccurrence(text, word, k) {
  const re = new RegExp(`(?<![\\p{L}\\p{N}'\u2019\\-])${escapeRegExp(word)}(?![\\p{L}\\p{N}'\u2019\\-])`, "gu");
  let m;
  let n = 0;
  while (m = re.exec(text)) {
    n++;
    if (n === k) return m.index;
    if (m[0].length === 0) re.lastIndex++;
  }
  return -1;
}
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_2, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}
const COMMON_TYPOS = {
  en: {
    teh: "the",
    hte: "the",
    adn: "and",
    nad: "and",
    taht: "that",
    thier: "their",
    recieve: "receive",
    recieved: "received",
    seperate: "separate",
    definately: "definitely",
    occured: "occurred",
    untill: "until",
    wich: "which",
    becuase: "because",
    freind: "friend",
    beleive: "believe",
    acheive: "achieve",
    accomodate: "accommodate",
    occassion: "occasion",
    tommorow: "tomorrow",
    truely: "truly",
    wierd: "weird",
    goverment: "government",
    enviroment: "environment",
    neccessary: "necessary",
    occurence: "occurrence",
    publically: "publicly",
    recomend: "recommend",
    refered: "referred",
    succesful: "successful",
    tounge: "tongue",
    writting: "writing",
    yuo: "you",
    jsut: "just",
    waht: "what",
    whihc: "which",
    wiht: "with",
    thsi: "this",
    tihs: "this",
    dont: "don't",
    doesnt: "doesn't",
    didnt: "didn't",
    cant: "can't",
    wont: "won't",
    isnt: "isn't",
    wasnt: "wasn't",
    havent: "haven't",
    im: "I'm",
    ive: "I've"
  },
  da: {
    ogsaa: "ogs\xE5",
    hvordn: "hvordan",
    ig\u00E5r: "i g\xE5r",
    idag: "i dag",
    imorgen: "i morgen",
    i\u00F8vrigt: "i \xF8vrigt",
    istedet: "i stedet",
    intresant: "interessant",
    intressant: "interessant",
    interesant: "interessant",
    resturant: "restaurant",
    mellom: "mellem",
    virkeligt: "virkelig"
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  COMMON_TYPOS,
  CONFUSABLES,
  detectLang,
  editDistance,
  escapeRegExp,
  isWordChar,
  nthWordOccurrence,
  shouldSkip,
  transferCase,
  windowBefore,
  wordAt,
  wordEndingAt,
  wordsBefore
});
