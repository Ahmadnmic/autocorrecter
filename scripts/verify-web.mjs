// Post-deploy verification of the live web app: every pass the editor relies on is exercised against the real
// API with representative input, and the run fails if any of them stops answering the way the page expects.
// Usage: node scripts/verify-web.mjs [https://inline-autocorrect.vercel.app]
const base = (process.argv[2] || "https://inline-autocorrect.vercel.app").replace(/\/$/, "");
const failures = [];
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!cond) failures.push(name);
};
const post = async (path, body) => {
  const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};

// page and headers
{
  const r = await fetch(base + "/");
  const csp = r.headers.get("content-security-policy") || "";
  ok("page loads", r.status === 200);
  ok("CSP nonce present", /nonce-/.test(csp));
  ok("HSTS", !!r.headers.get("strict-transport-security"));
}
// health
{
  const h = await (await fetch(base + "/api/health")).json();
  ok("health: spell", h.spell?.ok, h.spell?.note);
  ok("health: jev configured", h.jev?.ok, h.jev?.note);
  ok("health: anthropic configured", h.anthropic?.ok, h.anthropic?.note);
}
// typo table + jev typo + recheck + prefilter in one batched call
{
  const { status, json } = await post("/api/jev", {
    client: "verify",
    lang: "en",
    aggressiveness: 0.5,
    typos: [
      { id: "a", word: "definately", left: "I " },
      { id: "b", word: "recieved", left: "I definitely " },
    ],
    recheck: [{ id: "r", word: "then", alternatives: ["than"], left: "She is more taller ", right: " me and it had a big effect." }],
    prefilter: { window: "The report was send to the client last week and they was happy with the result. We need to discuss about the budget before we makes a final decision, and the" },
  });
  ok("jev: 200", status === 200, String(status));
  const t = Object.fromEntries((json.typos || []).map((x) => [x.id, x]));
  ok("jev: typo table", t.a?.replace && t.a.to === "definitely", JSON.stringify(t.a));
  ok("jev: hunspell + jev typo", t.b?.replace && t.b.to === "received", JSON.stringify(t.b));
  ok("jev: confusable re-check", json.recheck?.[0]?.replace && json.recheck[0].to === "than", JSON.stringify(json.recheck?.[0]));
  ok("jev: pre-filter says call Haiku", json.prefilter?.callHaiku === true, JSON.stringify(json.prefilter));
}
// context pass: Haiku proposes, Jev gates
{
  const { status, json } = await post("/api/propose", { window: "The report was send to the client last week and they was happy with the result. We need to discuss about the budget before we makes a final decision, and the", lang: "en", aggressiveness: 0.5, tone: "as-written", skipPrefilter: true });
  ok("propose: 200", status === 200, String(status));
  const approved = json.approved || [];
  ok("propose: at least one context fix approved", approved.length >= 1, approved.map((a) => `${a.original}->${a.to}`).join(", ") || json.why);
  ok("propose: offsets point at the original words", approved.every((a) => "The report was send to the client last week and they was happy with the result. We need to discuss about the budget before we makes a final decision, and the".slice(a.offset, a.offset + a.original.length) === a.original));
}
// tone pass
{
  const { json } = await post("/api/propose", { window: "Hey guys, the thing is kinda broken and we gotta fix a bunch of stuff before the demo, so please", lang: "en", aggressiveness: 0.5, tone: "formal", skipPrefilter: true });
  ok("propose: tone changes with a formal tone", (json.approved || []).some((a) => a.kind === "tone"), (json.approved || []).map((a) => `${a.original}->${a.to} (${a.kind})`).join(", ") || json.why);
}
// sentence repair on a pause (missing comma between clauses), and clean sentences left alone
{
  const { json } = await post("/api/propose", { window: "Hi i want to do it but cant how do i do it", lang: "en", aggressiveness: 0.5, skipPrefilter: true, paused: true });
  ok("propose: repairs a sentence missing an inner comma", /,/.test(json.rewrite?.to ?? ""), json.rewrite?.to ?? "(none)");
  const clean = await post("/api/propose", { window: "The meeting is at three and we will bring the slides", lang: "en", aggressiveness: 0.5, skipPrefilter: true, paused: true });
  ok("propose: leaves a clean sentence alone", !clean.json.rewrite, clean.json.rewrite?.to ?? "");
}
// translation
{
  const { json } = await post("/api/decide", { word: "hjælpsom", left: "The team was very ", lang: "en", aggressiveness: 0.5, translate: true });
  ok("decide: Danish word translated in English text", json.replace && json.kind === "translate", JSON.stringify(json).slice(0, 120));
}
// late resolution
{
  const { json } = await post("/api/resolve", { items: [{ id: "x", word: "woyou", left: "the tasks and ", right: " please check it tomorrow." }], lang: "en", aggressiveness: 0.5 });
  ok("resolve: woyou -> would you", json.decisions?.[0]?.replace && /would you/i.test(json.decisions[0].to), JSON.stringify(json.decisions?.[0]));
}
// library, manifest, log
{
  const lib = await (await fetch(base + "/api/library")).json();
  ok("library served", typeof lib.count === "number", `v${lib.version}, ${lib.count} entries`);
  const rel = await (await fetch(base + "/api/desktop-version")).json();
  ok("desktop manifest signed", !!rel.signed?.signature && !!rel.version, rel.version);
  const { status } = await post("/api/log", { client: "verify", session: "verify", events: [{ kind: "applied", old: "definately", to: "definitely", changeKind: "typo", lang: "en" }] });
  ok("log accepted", status === 200);
  ok("cron route gated", (await fetch(base + "/api/learn")).status === 401);
  ok("feedback inbox gated", (await fetch(base + "/api/feedback")).status === 401);
}
console.log(failures.length ? `\n${failures.length} check(s) failed: ${failures.join("; ")}` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
