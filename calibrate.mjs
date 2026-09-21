// Autocomplete calibration: replays a text with 2- and 3-letter prefixes and reports hit rate / precision by threshold.
// Usage: node calibrate.mjs [baseUrl]
const base = process.argv[2] ?? "https://inline-autocorrect.vercel.app";
const TEXT = `We scheduled a meeting for Tuesday, which turned out to be more useful than I expected. The team was very helpful and everyone shared their opinions openly. By the end we had a clear list of tasks and I felt relieved. The next step is to write a short summary for the customer and send it before Friday. I think it's going to be fine, as long as we don't underestimate the amount of work that is left. Tomorrow I will go through the budget once more and make sure the numbers are accurate, and then we can finally begin the implementation. Our manager asked whether the schedule was realistic, and honestly nobody could answer that question with confidence. The marketing department wants a presentation on Thursday afternoon, so we should prepare the slides tomorrow morning.`;
const words = [...TEXT.matchAll(/[A-Za-z']+/g)];
const rows = [];
for (const m of words) {
  const w = m[0];
  if (w.length < 5) continue;
  const left = TEXT.slice(0, m.index);
  for (const n of [2, 3]) {
    const partial = w.slice(0, n);
    const r = await fetch(`${base}/api/jev`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lang: "en", aggressiveness: 0.5, doc: TEXT, complete: { partial, left } }) }).then((r) => r.json());
    const c = r.complete ?? {};
    const best = c.candidates?.[0];
    const chosen = c.to ?? null;
    const prefixSafe = chosen ? w.toLowerCase().startsWith(chosen.toLowerCase()) : null;
    rows.push({ w, n, partial, conf: c.confidence ?? 0, margin: c.margin, chosen, space: c.addSpace, correct: chosen ? chosen.toLowerCase() === w.toLowerCase() : null, prefixSafe, best });
  }
}
const eligible = words.filter((m) => m[0].length >= 5).length;
console.log(`words ≥5 letters: ${eligible} of ${words.length}`);
for (const n of [2, 3]) {
  const rs = rows.filter((r) => r.n === n);
  console.log(`\nprefix length ${n}: fired ${rs.filter((r) => r.chosen).length}/${rs.length}, exact ${rs.filter((r) => r.correct).length}, stem-only (prefix of the intended word, no space) ${rs.filter((r) => r.correct === false && r.prefixSafe).length}, wrong ${rs.filter((r) => r.correct === false && !r.prefixSafe).length}`);
  for (const r of rs.filter((r) => r.chosen && !r.correct)) console.log(`  ${r.partial.padEnd(4)} -> ${String(r.chosen).padEnd(16)} conf ${r.conf.toFixed(2)} space=${r.space} ${r.prefixSafe ? "stem of " + r.w : "WRONG (" + r.w + ")"}`);
}
console.log(`\nMissed with conf≥0.6 (would fire at a lower bar):`);
for (const r of rows.filter((r) => !r.chosen && r.conf >= 0.6)) console.log(`  ${r.partial.padEnd(4)} (${r.w}) conf ${r.conf.toFixed(2)} margin ${r.margin} best=${r.best}`);
