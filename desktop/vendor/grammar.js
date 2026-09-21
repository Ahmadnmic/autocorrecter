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
var grammar_exports = {};
__export(grammar_exports, {
  grammarFix: () => grammarFix
});
module.exports = __toCommonJS(grammar_exports);
const ABBREV = /* @__PURE__ */ new Set(["e.g", "i.e", "etc", "vs", "mr", "mrs", "ms", "dr", "prof", "st", "no", "ca", "fx", "bl.a", "osv", "dvs", "evt", "mv", "jf", "pga", "ifm", "hhv", "inkl", "ekskl", "ca", "kl", "nr"]);
function grammarFix(text, p, lang = "en") {
  const ch = text[p];
  const prev = text[p - 1];
  const prev2 = text[p - 2];
  if (lang === "en" && !isWordCharLocal(ch) && prev === "i" && !isWordCharLocal(prev2) && !(prev2 === "'" || prev2 === "\u2019")) {
    return { start: p - 1, end: p, to: "I", note: "pronoun I" };
  }
  if (ch === " " && prev === " ") return { start: p, end: p + 1, to: "", note: "double space" };
  if (/[,.;:!?)]/.test(ch) && prev === " " && p >= 2 && /[\p{L}\p{N})"'’”]/u.test(prev2 ?? "")) {
    if (!(ch === "." && /\p{N}/u.test(prev2 ?? ""))) return { start: p - 1, end: p, to: "", note: `space before ${ch}` };
  }
  if (ch === " " && prev === "(") return { start: p, end: p + 1, to: "", note: "space after (" };
  if (ch === " " && prev === '"' && quoteIsOpening(text, p - 1)) return { start: p, end: p + 1, to: "", note: "space after opening quote" };
  if (ch === '"' && prev === " " && !quoteIsOpening(text, p) && p >= 2 && /[\p{L}\p{N}.,!?]/u.test(prev2 ?? "")) {
    return { start: p - 1, end: p, to: "", note: "space before closing quote" };
  }
  if (/\p{L}/u.test(ch) && /[,;:!?.]/.test(prev ?? "")) {
    const before = text[p - 2] ?? "";
    if (/\p{L}/u.test(before)) {
      const wordBefore = text.slice(0, p - 1).match(/[\p{L}.]+$/u)?.[0].toLowerCase() ?? "";
      const isUrlish = /\.(com|org|net|dk|io|co|app|ai)$/i.test(wordBefore + "." + ch) || /^(www|http)/i.test(wordBefore);
      if (prev === "." && (ABBREV.has(wordBefore.replace(/\.$/, "")) || wordBefore.length <= 2 || isUrlish)) return null;
      if (prev !== "." || wordBefore.length > 2) return { start: p, end: p, to: " ", note: `space after ${prev}` };
    }
  }
  if (/\p{L}/u.test(ch) && prev === ")") return { start: p, end: p, to: " ", note: "space after )" };
  if (ch === "(" && /[\p{L}\p{N}]/u.test(prev ?? "")) return { start: p, end: p, to: " ", note: "space before (" };
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
  if (ch === "," && prev === "," || ch === ";" && prev === ";") return { start: p, end: p + 1, to: "", note: `double ${ch}` };
  return null;
}
function quoteIsOpening(text, i) {
  const paraStart = text.lastIndexOf("\n", i - 1) + 1;
  let n = 0;
  for (let k = paraStart; k < i; k++) if (text[k] === '"') n++;
  return n % 2 === 0;
}
function isWordCharLocal(c) {
  return !!c && /[\p{L}\p{M}\p{N}'’\-]/u.test(c);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  grammarFix
});
