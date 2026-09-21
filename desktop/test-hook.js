// Replays real uiohook-style key events (Danish Mac layout) through the shared handler and the engine.
const { UiohookKey: K } = require("uiohook-napi");
const { Engine } = require("./engine.js");
const { makeKeyHandler } = require("./hook.js");
async function main() {
  let screen = "";
  const engine = new Engine({ apiBase: "https://inline-autocorrect.vercel.app", settings: () => ({ aggressiveness: 0.5, lang: "auto", enabled: true }), apply: Object.assign(async ({ tail, old, to }) => { const cut = screen.length - tail - old.length; if (screen.slice(cut, cut + old.length) !== old) return false; screen = screen.slice(0, cut) + to + screen.slice(cut + old.length); return true; }, { atomic: true }), onChange: (c) => console.log(`  change: ${c.old} -> ${c.to} [${c.kind}]`) });
  const handler = makeKeyHandler({ engine, UiohookKey: K, getLayout: () => "da-mac" });
  const codes = { " ": K.Space, ",": K.Comma, ".": K.Period, "æ": K.Semicolon, "ø": K.Quote, "å": K.BracketLeft };
  const type = async (str) => { for (const ch of str) { const upper = ch !== ch.toLowerCase(); const code = codes[ch] ?? K[ch.toUpperCase()]; if (!code) throw new Error("no code for " + ch); screen += ch; handler({ keycode: code, shiftKey: upper, ctrlKey: false, metaKey: false, altKey: false }); await new Promise((r) => setTimeout(r, 35)); } };
  await type("I definately think we should seperate ,the tasks and woyou please check it tomorrow. Vi skal huske og sende det ");
  await new Promise((r) => setTimeout(r, 6000));
  console.log("screen:", JSON.stringify(screen));
  console.log(screen === engine.buf ? "OK: screen and buffer agree" : "MISMATCH: " + JSON.stringify(engine.buf));
  process.exit(screen === engine.buf ? 0 : 1);
}
main();
