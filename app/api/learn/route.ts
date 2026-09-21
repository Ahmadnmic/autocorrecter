// The learning job (cron every 10 minutes). Closed feedback loop:
//   log -> implicit labels (kept = positive, reverted = negative) -> aggregate with minimum support ->
//   one cheap Haiku vetting call per batch -> promote to the deterministic library -> version it.
// Nothing enters the library from a single observation, a reverted correction vetoes promotion, and Haiku is
// only called when there are candidates, on a compact list, with a tiny output schema.
import { NextResponse } from "next/server";
import { list, put } from "@vercel/blob";
import { anthropicConfigured, anthropicKey } from "@/lib/haiku";
import { loadLibrary, saveLibrary, type Library } from "@/lib/library";
import type { LogEvent } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MIN_SUPPORT = 2; // same typed -> to seen at least twice, from at least this many events
const STATE_PATH = "library/learn-state.json";
type State = { cursor: string; lastReleaseCount: number; runs: number };

type Agg = { to: Record<string, number>; reverts: number; lang: string; kinds: Set<string>; contexts: string[] };

async function loadState(): Promise<State> {
  try {
    const { blobs } = await list({ prefix: STATE_PATH, limit: 1 });
    if (!blobs.length) return { cursor: "", lastReleaseCount: 0, runs: 0 };
    return (await (await fetch(blobs[0].url, { cache: "no-store" })).json()) as State;
  } catch {
    return { cursor: "", lastReleaseCount: 0, runs: 0 };
  }
}
const saveState = (s: State) => put(STATE_PATH, JSON.stringify(s), { access: "public", addRandomSuffix: false, contentType: "application/json", allowOverwrite: true });

async function readClientEvents(sinceIso: string, max = 3000): Promise<{ events: LogEvent[]; newest: string }> {
  const days = new Set<string>();
  const start = sinceIso ? new Date(sinceIso) : new Date(Date.now() - 2 * 86400_000);
  for (let d = new Date(start); d <= new Date(); d.setUTCDate(d.getUTCDate() + 1)) days.add(d.toISOString().slice(0, 10));
  const events: LogEvent[] = [];
  let newest = sinceIso;
  for (const day of days) {
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: `logs/${day}/`, limit: 1000, cursor });
      cursor = page.hasMore ? page.cursor : undefined;
      const wanted = page.blobs.filter((b) => /-client(-[A-Za-z0-9]+)?\.json$/.test(b.pathname) && b.uploadedAt.toISOString() > sinceIso);
      const bodies = await Promise.all(wanted.slice(0, max - events.length).map((b) => fetch(b.url).then((r) => r.json()).catch(() => null)));
      for (const [i, ev] of bodies.entries()) {
        if (!ev) continue;
        events.push(ev as LogEvent);
        const up = wanted[i].uploadedAt.toISOString();
        if (up > newest) newest = up;
      }
      if (events.length >= max) return { events, newest };
    } while (cursor);
  }
  return { events, newest };
}

async function vetWithHaiku(cands: { typed: string; to: string; n: number; lang: string; kind: string; context: string }[]): Promise<Record<string, { ok: boolean; note: string }>> {
  if (!anthropicConfigured() || !cands.length) return Object.fromEntries(cands.map((c) => [c.typed, { ok: true, note: "unvetted" }]));
  const lines = cands.map((c, i) => `${i}. "${c.typed}" -> "${c.to}" (${c.lang}, seen ${c.n}x, ${c.kind}) e.g. …${c.context}`).join("\n");
  const schema = { type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", items: { type: "object", additionalProperties: false, required: ["i", "ok", "note"], properties: { i: { type: "integer" }, ok: { type: "boolean" }, note: { type: "string" } } } } } };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": anthropicKey(), "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 40 * cands.length + 50,
        system: "You vet candidate entries for an autocorrect library. Each maps a typed string to a replacement that real users kept. Approve (ok=true) only entries that are safe to apply automatically in ANY context in that language: clear misspellings, merged words, keyboard slips. Reject names, slang, abbreviations, words that are correct in some contexts, or replacements that change meaning. Notes: max 6 words.",
        messages: [{ role: "user", content: lines }],
        output_config: { format: { type: "json_schema", schema } },
      }),
      cache: "no-store",
    });
    const json = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = json.content?.find((c) => c.type === "text")?.text ?? "{}";
    const items = (JSON.parse(text) as { items?: { i: number; ok: boolean; note: string }[] }).items ?? [];
    const out: Record<string, { ok: boolean; note: string }> = {};
    for (const it of items) if (cands[it.i]) out[cands[it.i].typed] = { ok: it.ok, note: it.note };
    for (const c of cands) out[c.typed] ??= { ok: false, note: "no verdict" };
    return out;
  } catch {
    return Object.fromEntries(cands.map((c) => [c.typed, { ok: false, note: "vetting unavailable" }]));
  }
}

export async function GET(req: Request) {
  const t0 = Date.now();
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return NextResponse.json({ error: "no_blob" }, { status: 503 });

  const state = await loadState();
  const lib = await loadLibrary(0);
  const { events, newest } = await readClientEvents(state.cursor);

  // 1. aggregate implicit labels
  const agg = new Map<string, Agg>();
  const key = (s: string) => s.toLowerCase().trim();
  for (const ev of events) {
    const i = (ev.in ?? {}) as { old?: string; to?: string; changeKind?: string; left?: string };
    if (!i.old || !i.to) continue;
    const k = key(i.old);
    if (!/^[\p{L}'’-]{2,24}$/u.test(k) || i.changeKind === "grammar" || i.changeKind === "complete") continue;
    const a = agg.get(k) ?? { to: {}, reverts: 0, lang: ev.lang ?? "en", kinds: new Set<string>(), contexts: [] };
    if (ev.kind === "applied" || ev.kind === "resolved") {
      a.to[i.to] = (a.to[i.to] ?? 0) + 1;
      if (a.contexts.length < 2 && i.left) a.contexts.push(i.left.slice(-60));
    } else if (ev.kind === "reverted") a.reverts++;
    if (i.changeKind) a.kinds.add(i.changeKind);
    agg.set(k, a);
  }

  // 2. candidates with support, no reverts; reverted words go on the never list
  const cands: { typed: string; to: string; n: number; lang: string; kind: string; context: string }[] = [];
  const never = new Set(lib.never);
  for (const [typed, a] of agg) {
    if (a.reverts >= 2) {
      never.add(typed);
      delete lib.entries[typed];
      continue;
    }
    if (a.reverts > 0 || lib.entries[typed] || never.has(typed)) continue;
    const [to, n] = Object.entries(a.to).sort((x, y) => y[1] - x[1])[0] ?? ["", 0];
    if (!to || n < MIN_SUPPORT || to.toLowerCase() === typed) continue;
    cands.push({ typed, to, n, lang: a.lang, kind: [...a.kinds].join("/"), context: a.contexts[0] ?? "" });
  }

  // 3. vet once per batch, promote
  const verdicts = await vetWithHaiku(cands.slice(0, 60));
  let added = 0;
  for (const c of cands.slice(0, 60)) {
    const v = verdicts[c.typed];
    if (!v?.ok) continue;
    lib.entries[c.typed] = { to: c.to, n: c.n, lang: c.lang, note: v.note };
    added++;
  }
  const changed = added > 0 || never.size !== lib.never.length;
  lib.never = [...never];
  lib.count = Object.keys(lib.entries).length;
  if (changed) {
    lib.version += 1;
    lib.updatedAt = new Date().toISOString();
    await saveLibrary(lib);
  }
  // 4. every 50 new entries: mark a library release, which the clients surface as an update prompt
  let release = false;
  if (lib.count - state.lastReleaseCount >= 50) {
    state.lastReleaseCount = lib.count;
    release = true;
  }
  state.cursor = newest || state.cursor;
  state.runs += 1;
  await saveState(state);

  const summary = { events: events.length, candidates: cands.length, added, neverCount: lib.never.length, libraryCount: lib.count, libraryVersion: lib.version, release, ms: Date.now() - t0 };
  await put(`logs/learn/${new Date().toISOString().slice(0, 13)}.json`, JSON.stringify({ ...summary, at: new Date().toISOString(), rejected: cands.filter((c) => !verdicts[c.typed]?.ok).map((c) => ({ typed: c.typed, to: c.to, note: verdicts[c.typed]?.note })) }), { access: "public", addRandomSuffix: true, contentType: "application/json" }).catch(() => {});
  return NextResponse.json(summary);
}
