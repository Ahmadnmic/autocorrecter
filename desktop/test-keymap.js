const { UiohookKey } = require("uiohook-napi");
const { charFor } = require("./keymap.js");
const K = UiohookKey;
const ev = (keycode, shiftKey = false) => ({ keycode, shiftKey });
let fails = 0;
const check = (layout, seq, expected, caps = false) => {
  const got = seq.map((e) => charFor(e, K, layout, caps) ?? "").join("");
  if (got !== expected) { fails++; console.log(`FAIL ${layout}: got ${JSON.stringify(got)} expected ${JSON.stringify(expected)}`); } else console.log(`ok   ${layout}: ${JSON.stringify(got)}`);
};
check("us", [ev(K.H), ev(K.I), ev(K.Comma), ev(K.Space), ev(K.T, true), ev(K.Quote), ev(K.S), ev(K.Period), ev(K["1"], true)], "hi, T's.!");
check("da-mac", [ev(K.B), ev(K.L), ev(K.BracketLeft), ev(K.Space), ev(K.Semicolon, true), ev(K.Quote), ev(K.Slash), ev(K.Comma), ev(K.Period, true), ev(K["8"], true)], "blå Æø-,:(");
check("da-win", [ev(K.Semicolon), ev(K.Quote), ev(K.BracketLeft), ev(K.Minus), ev(K.Minus, true)], "æøå+?");
check("us", [ev(K.A), ev(K.B, true)], "Ab", true);
process.exit(fails ? 1 : 0);
