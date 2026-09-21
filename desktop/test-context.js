// Replays a paragraph with context errors (wrong word for the meaning) through the engine against the live API
// and expects the context pass (Jev pre-filter -> Haiku proposals -> Jev gate) to fix at least one of them.
const { UiohookKey: K } = require("uiohook-napi");
const { Engine } = require("./engine.js");
const { makeKeyHandler } = require("./hook.js");
async function main() {
  let screen = "";
  const kinds = [];
  const engine = new Engine({ apiBase: process.env.ICA_API_BASE || "https://inline-autocorrect.vercel.app", settings: () => ({ aggressiveness: 0.5, lang: "en", tone: "as-written", enabled: true }), apply: Object.assign(async ({ tail, old, to }) => { const cut = screen.length - tail - old.length; if (screen.slice(cut, cut + old.length) !== old) return false; screen = screen.slice(0, cut) + to + screen.slice(cut + old.length); return true; }, { atomic: true }), onChange: (c) => { kinds.push(c.kind); console.log(`  change: ${c.old} -> ${c.to} [${c.kind}]`); }, log: (m) => process.env.ICA_DEBUG && console.log("  " + m) });
  const handler = makeKeyHandler({ engine, UiohookKey: K, getLayout: () => "us" });
  const codes = { " ": K.Space, ",": K.Comma, ".": K.Period, "'": K.Quote };
  const type = async (str) => { for (const ch of str) { const upper = ch !== ch.toLowerCase(); const code = codes[ch] ?? K[ch.toUpperCase()]; if (!code) throw new Error("no code for " + ch); screen += ch; handler({ keycode: code, shiftKey: upper, ctrlKey: false, metaKey: false, altKey: false }); await new Promise((r) => setTimeout(r, 30)); } };
  await type("The report was send to the client last week and they was happy with the result. We need to discuss about the budget before we makes a final decision, and the team ");
  await new Promise((r) => setTimeout(r, 12000));
  console.log("screen:", JSON.stringify(screen));
  const ok = screen === engine.buf && kinds.includes("context");
  console.log(ok ? "OK: context pass applied and buffer agrees" : `FAIL: kinds=${kinds.join(",")} match=${screen === engine.buf}`);
  process.exit(ok ? 0 : 1);
}
main();
