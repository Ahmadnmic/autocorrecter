// Turns raw uiohook key events into engine calls. Shared by the app and the tests.
"use strict";
const { charFor } = require("./keymap.js");

function makeKeyHandler({ engine, UiohookKey, getLayout, onEvent }) {
  const RESET_KEYS = new Set([UiohookKey.Enter, UiohookKey.NumpadEnter, UiohookKey.Tab, UiohookKey.Escape, UiohookKey.ArrowLeft, UiohookKey.ArrowRight, UiohookKey.ArrowUp, UiohookKey.ArrowDown, UiohookKey.Home, UiohookKey.End, UiohookKey.PageUp, UiohookKey.PageDown, UiohookKey.Delete]);
  let capsLock = false;
  return (e) => {
    onEvent?.(e);
    if (engine.applying) return; // our own synthetic keystrokes
    if (e.keycode === UiohookKey.CapsLock) {
      capsLock = !capsLock;
      return;
    }
    if (e.keycode === UiohookKey.Shift || e.keycode === UiohookKey.ShiftRight || e.keycode === UiohookKey.Alt || e.keycode === UiohookKey.AltRight || e.keycode === UiohookKey.Ctrl || e.keycode === UiohookKey.CtrlRight || e.keycode === UiohookKey.Meta || e.keycode === UiohookKey.MetaRight) return;
    const mod = e.ctrlKey || e.metaKey || (e.altKey && process.platform !== "win32");
    if (mod) return engine.reset("modifier");
    if (e.keycode === UiohookKey.Backspace) return engine.backspace();
    if (RESET_KEYS.has(e.keycode)) return engine.reset("navigation");
    if (e.altKey && process.platform === "win32") return; // AltGr combos are not mapped
    const ch = charFor(e, UiohookKey, getLayout(), capsLock);
    if (ch) engine.char(ch);
  };
}

module.exports = { makeKeyHandler };
