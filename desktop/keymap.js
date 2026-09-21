// Key code -> character. uiohook reports layout-independent scan codes only, so the character depends on the
// keyboard layout in use. Supported: US and Danish (macOS and Windows), with Shift and Caps Lock.
"use strict";
const { execFile } = require("node:child_process");

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// [unshifted, shifted] per key name; null = dead key or nothing printable
const LAYOUTS = {
  us: {
    Digit: [DIGITS, [")", "!", "@", "#", "$", "%", "^", "&", "*", "("]],
    Backquote: ["`", "~"], Minus: ["-", "_"], Equal: ["=", "+"], BracketLeft: ["[", "{"], BracketRight: ["]", "}"],
    Backslash: ["\\", "|"], Semicolon: [";", ":"], Quote: ["'", '"'], Comma: [",", "<"], Period: [".", ">"], Slash: ["/", "?"],
    Lesser: ["<", ">"],
  },
  "da-mac": {
    Digit: [DIGITS, ["=", "!", '"', "#", "€", "%", "&", "/", "(", ")"]],
    Backquote: ["$", "§"], Minus: ["+", "?"], Equal: [null, null], BracketLeft: ["å", "Å"], BracketRight: [null, null],
    Backslash: ["'", "*"], Semicolon: ["æ", "Æ"], Quote: ["ø", "Ø"], Comma: [",", ";"], Period: [".", ":"], Slash: ["-", "_"],
    Lesser: ["<", ">"],
  },
  "da-win": {
    Digit: [DIGITS, ["=", "!", '"', "#", "¤", "%", "&", "/", "(", ")"]],
    Backquote: ["½", "§"], Minus: ["+", "?"], Equal: [null, null], BracketLeft: ["å", "Å"], BracketRight: [null, null],
    Backslash: ["'", "*"], Semicolon: ["æ", "Æ"], Quote: ["ø", "Ø"], Comma: [",", ";"], Period: [".", ":"], Slash: ["-", "_"],
    Lesser: ["<", ">"],
  },
};

let byCode = null;
function index(UiohookKey) {
  if (byCode) return byCode;
  byCode = new Map();
  for (const [name, code] of Object.entries(UiohookKey)) if (typeof code === "number" && !byCode.has(code)) byCode.set(code, name);
  return byCode;
}

/** Returns the typed character for a keydown event, or null when the key prints nothing. */
function charFor(e, UiohookKey, layout, capsLock) {
  const name = index(UiohookKey).get(e.keycode);
  if (!name) return null;
  const L = LAYOUTS[layout] || LAYOUTS.us;
  const shift = !!e.shiftKey;
  if (name === "Space") return " ";
  if (name.length === 1 && LETTERS.includes(name)) {
    const upper = shift !== !!capsLock;
    return upper ? name : name.toLowerCase();
  }
  if (/^[0-9]$/.test(name)) return L.Digit[shift ? 1 : 0][Number(name)];
  if (/^Numpad[0-9]$/.test(name)) return name.slice(-1);
  if (name === "NumpadAdd") return "+";
  if (name === "NumpadSubtract") return "-";
  if (name === "NumpadMultiply") return "*";
  if (name === "NumpadDivide") return "/";
  if (name === "NumpadDecimal") return layout.startsWith("da") ? "," : ".";
  const pair = L[name];
  if (!pair) return null;
  const ch = pair[shift ? 1 : 0];
  if (!ch) return null;
  // letters with caps lock (æøå)
  if (capsLock && /\p{L}/u.test(ch)) return shift ? ch.toLowerCase() : ch.toUpperCase();
  return ch;
}

/** Detects the active keyboard layout: "us", "da-mac" or "da-win". */
function detectLayout() {
  return new Promise((resolve) => {
    if (process.platform === "darwin") {
      execFile("defaults", ["read", "com.apple.HIToolbox", "AppleSelectedInputSources"], (err, out) => {
        if (err) return resolve("us");
        resolve(/KeyboardLayout Name"?\s*=\s*"?(Danish|Dansk)/i.test(out) ? "da-mac" : "us");
      });
    } else if (process.platform === "win32") {
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "(Get-WinUserLanguageList)[0].InputMethodTips"], { windowsHide: true }, (err, out) => {
        if (err) return resolve("us");
        resolve(/0406/.test(out) ? "da-win" : "us");
      });
    } else resolve("us");
  });
}

module.exports = { charFor, detectLayout, LAYOUTS };
