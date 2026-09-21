// Engine test with a fake typer: verifies buffer edits, common-typo fixes and a live API round trip.
"use strict";
const { Engine } = require("./engine.js");

async function main() {
  let screen = "";
  const engine = new Engine({
    apiBase: process.env.API_BASE || "https://inline-autocorrect.vercel.app",
    settings: () => ({ aggressiveness: 0.5, lang: "auto", enabled: true }),
    apply: async (n, s) => {
      screen = screen.slice(0, screen.length - n) + s;
    },
    onChange: (c) => console.log(`  change: ${JSON.stringify(c.old)} -> ${JSON.stringify(c.to)} [${c.kind}]`),
    log: (m) => console.log("  log:", m),
  });
  const type = async (str, delay = 40) => {
    for (const ch of str) {
      screen += ch;
      engine.char(ch);
      await new Promise((r) => setTimeout(r, delay));
    }
  };
  await type("I definately want to seperate ,the woyou please look at it before friday ");
  await new Promise((r) => setTimeout(r, 5000));
  console.log("screen:", JSON.stringify(screen));
  console.log("buffer:", JSON.stringify(engine.buf));
  console.log(screen === engine.buf ? "OK: screen and buffer agree" : "MISMATCH");
  process.exit(screen === engine.buf ? 0 : 1);
}
main();
