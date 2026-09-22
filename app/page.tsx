"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { COMMON_TYPOS, CONFUSABLES, detectLang, isWordChar, shouldSkip, transferCase, wordAt, wordEndingAt, wordsBefore, windowBefore, type Lang } from "@/lib/text";
import { grammarFix } from "@/lib/grammar";

type Kind = "typo" | "recheck" | "context" | "tone" | "translate" | "complete" | "grammar";
type Range = { start: number; end: number };
type Change = Range & { id: string; old: string; to: string; kind: Kind; confidence: number; at: number; reverted: boolean; stale?: boolean; alternatives?: string[]; note?: string };
type Highlight = Range & { id: string; kind: Kind; until: number };
type Frozen = Range & { untilCommit: number };
type Edit = { p: number; removed: number; inserted: number; version: number };
type Snapshot = { text: string; caret: number; version: number };
type Span = Range & { word: string };
type Health = { spell?: { ok: boolean; note: string }; jev?: { configured: boolean; ok: boolean; note: string; ms?: number }; anthropic?: { configured: boolean; ok: boolean; note: string; ms?: number }; region?: string; build?: string } | null;
const BUILD = process.env.NEXT_PUBLIC_BUILD ?? "";
const SESSION = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
type LogEv = { kind: string; old?: string; to?: string; changeKind?: string; lang?: string; left?: string; right?: string; confidence?: number; source?: string };
const logQueue: LogEv[] = [];
let logTimer: ReturnType<typeof setTimeout> | null = null;
function logClient(ev: LogEv) {
  const scrub = (t?: string) => (t ?? "").replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>").replace(/\S*\d\S*\d\S*/g, "<num>").replace(/\S{20,}/g, "<long>");
  if (/@/.test(ev.old ?? "") || /@/.test(ev.to ?? "")) return;
  ev = { ...ev, left: scrub(ev.left), right: scrub(ev.right) };
  logQueue.push(ev);
  if (logTimer) return;
  logTimer = setTimeout(() => {
    logTimer = null;
    const events = logQueue.splice(0, 50);
    if (!events.length) return;
    fetch("/api/log", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client: "web", session: SESSION, events }), keepalive: true }).catch(() => {});
  }, 1500);
}
type Library = { version: number; count: number; updatedAt: string; entries: Record<string, { to: string; n: number; lang: string }>; never: string[] };
type Release = { version: string; notes?: string; assets: Record<string, string>; library?: { version: number; count: number; updatedAt: string } };

export type Tone = "as-written" | "neutral" | "formal" | "professional" | "casual" | "friendly" | "academic" | "concise";
const TONES: { value: Tone; label: string; hint: string }[] = [
  { value: "as-written", label: "As written", hint: "Only fix errors. Never touch style." },
  { value: "neutral", label: "Neutral", hint: "Plain, clear, no slang and no jargon." },
  { value: "formal", label: "Formal", hint: "No contractions or slang; measured word choice." },
  { value: "professional", label: "Professional", hint: "Workplace register: direct, courteous, concrete." },
  { value: "casual", label: "Casual", hint: "Conversational, contractions welcome." },
  { value: "friendly", label: "Friendly", hint: "Warm and approachable without being cute." },
  { value: "academic", label: "Academic", hint: "Precise, hedged where needed, no colloquialisms." },
  { value: "concise", label: "Concise", hint: "Prefer the shorter, plainer word." },
];

const HIGHLIGHT_MS = 5000;
const FREEZE_COMMITS = 3;

// Demo: two paragraphs typed with the system on (about seven lines).
// Planted: typos (recieved, seperate, definately, suprised, anwser, discribe, wich, usefull, relived, summery, Tommorow,
// adress, comunication, becuase, meating), confusables that need right-context (their/there, to/too, effect/affect,
// then/than, its/it's, loose/lose, except/accept, brake/break, hole/whole, past/passed, were/where, principle/principal,
// quite/quiet, piece/peace, write/right, weather/whether), spacing and capitalisation errors, wrong words for the
// meaning (threw/through), autocomplete
// opportunities marked with "|", Danish words (dokument, hjælpsom, kunden, fredag, beskeder) for auto-translation, and
// casual words (a bunch of, kinda, gonna, stuff) that only change when a formal/professional/academic tone is selected.
const DEMO_OFF = `Last week I recieved an email from a colleague who wanted to seperate the project into two phases ,and I definately agreed even though their were to many open questions and it was hard to see how the changes would effect the timeline.Our manager was suprised that nobody had a clear anwser and asked woyou please look at it , so she asked us to discribe the risks in a short dokument before the next meeting. She also said we should except the delay and not brake the schedule, since the hole team had past the point were changes are cheap and the principle risk was loosing the client.`;
const DEMO_ON = `We scheduled a meeting for Tuesday ,wich turned out to be more usefull then I expected.the team was very hjælpsom and everyone shared there opinions openly.By the end we had a bunch of tasks  and I felt kinda relived. The next step is to write a short summery for the kunden and send it before fredag ,and then wait for there feedback. I think its gonna be fine ofcourse, as long as we dont underestimate the amount of stuff that is left. Tommorow I will go threw the budget once more and make sure the numbers are accurate, and then we can finally begin the implementation. We also need to adress the comunication problem ,becuase to many people recieve to much beskeder at once and loose track of what is important. Its a quite room to work in, so we can discuss things in piece and make sure everyone has the write information before the meating ends, weather they except it or not.`;

let idSeq = 0;
const nextId = () => `c${Date.now().toString(36)}${(idSeq++).toString(36)}`;

async function postJSON<T>(url: string, body: unknown, signal?: AbortSignal, timeoutMs = 6000): Promise<T & { status: number }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  signal?.addEventListener("abort", () => ctrl.abort());
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal }).finally(() => clearTimeout(timer));
  const j = (await r.json().catch(() => ({}))) as T;
  return { ...j, status: r.status };
}

function shiftRange<T extends Range>(r: T, e: Edit): T | null {
  const delta = e.inserted - e.removed;
  const editEnd = e.p + e.removed;
  if (r.end <= e.p) return r;
  if (r.start >= editEnd) return { ...r, start: r.start + delta, end: r.end + delta };
  return null;
}
const overlaps = (a: Range, b: Range) => a.start < b.end && b.start < a.end;
const showWs = (s: string) => (s === "" ? "∅" : s.replace(/ /g, "␣").replace(/\n/g, "⏎"));

// ---- batched Jev pipeline: one request in flight, everything that happens meanwhile merges into the next one ----
type TypoSlot = { id: string; snap: Snapshot; w: Span };
type RecheckSlot = { id: string; snap: Snapshot; sp: Span; alternatives: string[]; right: string; completed?: boolean };
type Slots = { complete?: { snap: Snapshot; w: Span }; typos: Map<string, TypoSlot>; recheck: Map<string, RecheckSlot>; prefilter?: { snap: Snapshot; winStart: number; text: string } };
const emptySlots = (): Slots => ({ typos: new Map(), recheck: new Map() });
const slotsEmpty = (s: Slots) => !s.complete && s.typos.size === 0 && s.recheck.size === 0 && !s.prefilter;

export default function Page() {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef("");
  const versionRef = useRef(0);
  const commitRef = useRef(0);
  const editLogRef = useRef<Edit[]>([]);
  const frozenRef = useRef<Frozen[]>([]);
  const neverRef = useRef<Set<string>>(new Set());
  const undoArmedRef = useRef<{ changeId: string; version: number } | null>(null);
  const swallowSpaceRef = useRef<number | null>(null);
  const changesRef = useRef<Change[]>([]);
  const passCRef = useRef<{ inflight: boolean; dirty: { snap: Snapshot; winStart: number; text: string } | null }>({ inflight: false, dirty: null });
  const commitsSinceCRef = useRef(0);
  const MAX_INFLIGHT = 2;
  // Words the dictionary could not fix; re-asked (with Haiku) once two more words of context exist, up to 3 times.
  const unresolvedRef = useRef<Map<string, { snap: Snapshot; w: Span; commit: number; tries: number }>>(new Map());
  const resolveInflightRef = useRef(false);
  const busRef = useRef<{ slots: Slots; inflight: number; minGap: number; lastSent: number; timer: ReturnType<typeof setTimeout> | null }>({ slots: emptySlots(), inflight: 0, minGap: 120, lastSent: 0, timer: null });
  const systemOnRef = useRef(true);
  const lastInputRef = useRef(0);
  const lockRef = useRef(0); // text before this index was written with the system off and is never touched
  const serverLangRef = useRef<Lang | null>(null);
  const langProbeRef = useRef(0); // requests since the last full-document language detection
  const healthRef = useRef<Health>(null);

  const [text, setText] = useState("");
  const [changes, setChangesState] = useState<Change[]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [health, setHealth] = useState<Health>(null);
  const libraryRef = useRef<Library | null>(null);
  const [release, setRelease] = useState<Release | null>(null);
  const [dlOpen, setDlOpen] = useState(false);
  const [nudge, setNudge] = useState(false);
  const nudgeShownRef = useRef(false);
  const showNudge = () => {
    if (nudgeShownRef.current) return;
    try {
      if (localStorage.getItem("ica_nudge_dismissed") === new Date().toISOString().slice(0, 10)) return;
    } catch {}
    nudgeShownRef.current = true;
    setNudge(true);
    setTimeout(() => setNudge(false), 10_000);
  };
  const dismissNudge = () => {
    setNudge(false);
    try {
      localStorage.setItem("ica_nudge_dismissed", new Date().toISOString().slice(0, 10));
    } catch {}
  };
  const [aggr, setAggr] = useState(0.5);
  const [langMode, setLangMode] = useState<"auto" | Lang>("auto");
  const [tone, setTone] = useState<Tone>("as-written");
  const [autocomplete, setAutocomplete] = useState(false);
  const autocompleteRef = useRef(false);
  useEffect(() => {
    autocompleteRef.current = autocomplete;
  }, [autocomplete]);
  const [detected, setDetected] = useState<{ lang: Lang | null; en: number; da: number } | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const [title, setTitle] = useState("Untitled document");
  const [systemOn, setSystemOnState] = useState(true);
  const [demoRunning, setDemoRunning] = useState(false);
  const [demoPhase, setDemoPhase] = useState<"" | "off" | "on">("");
  const [drawer, setDrawer] = useState<null | "left" | "right">(null);
  const demoRef = useRef<{ running: boolean; timer: ReturnType<typeof setTimeout> | null }>({ running: false, timer: null });
  const [stats, setStats] = useState({ jev: 0, haiku: 0, completed: 0, applied: 0, reverted: 0, lastMs: 0, gap: 450, cWorth: null as number | null, rateLimited: 0 });

  const setChanges = (f: (c: Change[]) => Change[]) => {
    changesRef.current = f(changesRef.current);
    setChangesState(changesRef.current);
  };
  const setSystemOn = (v: boolean) => {
    if (v && !systemOnRef.current) lockRef.current = textRef.current.length;
    systemOnRef.current = v;
    setSystemOnState(v);
  };
  useEffect(() => {
    healthRef.current = health;
  }, [health]);

  // ---------- persistence, health, warm-up ----------
  useEffect(() => {
    try {
      if (!localStorage.getItem("ica_welcome_seen")) setShowWelcome(true);
      const a = localStorage.getItem("ica_aggr");
      if (a) setAggr(Number(a));
      const l = localStorage.getItem("ica_lang");
      if (l === "en" || l === "da" || l === "auto") setLangMode(l);
      const tn = localStorage.getItem("ica_tone") as Tone | null;
      if (tn && TONES.some((t) => t.value === tn)) setTone(tn);
      setAutocomplete(localStorage.getItem("ica_autocomplete") === "1");
      const t = localStorage.getItem("ica_title");
      if (t) setTitle(t);
      const saved = localStorage.getItem("ica_text");
      if (saved && taRef.current) {
        taRef.current.value = saved;
        textRef.current = saved;
        setText(saved);
      }
    } catch {}
    const load = (force = false) =>
      fetch(force ? "/api/health?force=1" : "/api/health")
        .then((r) => r.json())
        .then((h: Health) => {
          setHealth(h);
          // A newer build is deployed: reload as soon as the writer is idle (the text is saved locally).
          if (h?.build && BUILD && h.build !== BUILD) {
            const idle = () => {
              if (Date.now() - lastInputRef.current > 4000 && !demoRef.current.running) location.reload();
              else setTimeout(idle, 2000);
            };
            idle();
          }
        })
        .catch(() => setHealth(null));
    load(true);
    const nudgeTimer = setTimeout(showNudge, 10_000);
    const loadLibrary = () => fetch("/api/library").then((r) => r.json()).then((l: Library) => (libraryRef.current = l)).catch(() => {});
    const loadRelease = () => fetch("/api/desktop-version").then((r) => r.json()).then(setRelease).catch(() => {});
    loadLibrary();
    loadRelease();
    const il = setInterval(() => {
      loadLibrary();
      loadRelease();
    }, 600_000);
    const warm = () => prime();
    warm();
    const iv = setInterval(load, 60_000);
    const iw = setInterval(warm, 180_000);
    return () => {
      clearInterval(iv);
      clearInterval(iw);
      clearInterval(il);
      clearTimeout(nudgeTimer);
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("ica_aggr", String(aggr));
      localStorage.setItem("ica_lang", langMode);
      localStorage.setItem("ica_tone", tone);
      localStorage.setItem("ica_autocomplete", autocomplete ? "1" : "0");
      localStorage.setItem("ica_title", title);
    } catch {}
  }, [aggr, langMode, tone, autocomplete, title]);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem("ica_text", text);
      } catch {}
    }, 400);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => {
    const iv = setInterval(() => {
      const t = Date.now();
      setHighlights((h) => (h.some((x) => x.until <= t) ? h.filter((x) => x.until > t) : h));
    }, 250);
    return () => clearInterval(iv);
  }, []);

  const autosize = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.max(ta.scrollHeight, 900)}px`;
  };
  useEffect(autosize, [text]);

  const currentLang = useCallback((t: string): Lang => (langMode === "auto" ? serverLangRef.current ?? detectLang(t) : langMode), [langMode]);

  // ---------- range bookkeeping ----------
  const recordEdit = (e: Edit) => {
    editLogRef.current.push(e);
    if (e.p < lockRef.current) lockRef.current = e.p + e.removed <= lockRef.current ? lockRef.current + e.inserted - e.removed : e.p;
    if (editLogRef.current.length > 600) editLogRef.current.splice(0, 100);
    setHighlights((hs) => hs.map((h) => shiftRange(h, e)).filter((h): h is Highlight => !!h));
    setChanges((cs) => cs.map((c) => (c.reverted || c.stale ? c : (shiftRange(c, e) ?? { ...c, stale: true }))));
    frozenRef.current = frozenRef.current.map((f) => shiftRange(f, e)).filter((f): f is Frozen => !!f);
  };
  const relocate = (r: Range, fromVersion: number): Range | null => {
    let cur: Range | null = { ...r };
    for (const e of editLogRef.current) {
      if (e.version <= fromVersion) continue;
      cur = shiftRange(cur, e);
      if (!cur) return null;
    }
    return cur;
  };
  const replaceText = (start: number, end: number, to: string, caretTo?: number) => {
    const ta = taRef.current!;
    const old = textRef.current;
    const nt = old.slice(0, start) + to + old.slice(end);
    const delta = to.length - (end - start);
    const adj = (i: number) => (i >= end ? i + delta : i > start ? Math.min(i, start + to.length) : i);
    const s = caretTo ?? adj(ta.selectionStart);
    const e = caretTo ?? adj(ta.selectionEnd);
    ta.value = nt;
    ta.setSelectionRange(s, e);
    textRef.current = nt;
    versionRef.current += 1;
    recordEdit({ p: start, removed: end - start, inserted: to.length, version: versionRef.current });
    setText(nt);
  };

  /** Apply a word-level change instantly, after verifying the text is still what the decision was made on. */
  const applyChange = (p: { start: number; end: number; old: string; to: string; kind: Kind; confidence: number; version: number; alternatives?: string[]; note?: string; freezeFor?: number }) => {
    const r = relocate(p, p.version);
    if (!r) return false;
    const cur = textRef.current;
    if (r.start < lockRef.current) return false;
    if (cur.slice(r.start, r.end) !== p.old || p.to === p.old) return false;
    if (p.kind !== "grammar" && neverRef.current.has(p.old.toLowerCase())) return false;
    const caret = taRef.current?.selectionStart ?? cur.length;
    const cw = wordAt(cur, caret) ?? wordEndingAt(cur, caret);
    if (p.kind !== "grammar" && p.kind !== "complete" && cw && overlaps(cw, r)) return false;
    if (p.kind !== "recheck" && p.kind !== "grammar" && frozenRef.current.some((f) => f.untilCommit > commitRef.current && overlaps(f, r))) return false;
    if ((p.kind === "context" || p.kind === "tone") && changesRef.current.some((c) => !c.reverted && !c.stale && (c.kind === "context" || c.kind === "tone") && overlaps(c, r))) return false;
    replaceText(r.start, r.end, p.to);
    const done = { start: r.start, end: r.start + p.to.length };
    const changeId = nextId();
    if (done.end > done.start) setHighlights((hs) => [...hs, { ...done, id: changeId, kind: p.kind, until: Date.now() + HIGHLIGHT_MS }]);
    setChanges((cs) => [{ ...done, id: changeId, old: p.old, to: p.to, kind: p.kind, confidence: p.confidence, at: Date.now(), reverted: false, alternatives: p.alternatives, note: p.note }, ...cs].slice(0, 300));
    if (p.kind !== "grammar") frozenRef.current.push({ ...done, untilCommit: commitRef.current + (p.freezeFor ?? FREEZE_COMMITS) });
    undoArmedRef.current = { changeId, version: versionRef.current };
    setStats((s) => ({ ...s, applied: s.applied + 1 }));
    if (p.kind !== "grammar") logClient({ kind: p.note === "resolved with later context" ? "resolved" : "applied", old: p.old, to: p.to, changeKind: p.kind, lang: currentLang(cur), left: cur.slice(Math.max(0, r.start - 160), r.start), right: cur.slice(done.end, done.end + 120), confidence: p.confidence });
    return true;
  };

  const revertChange = (id: string) => {
    const c = changesRef.current.find((x) => x.id === id);
    if (!c || c.reverted || c.stale) return;
    if (textRef.current.slice(c.start, c.end) !== c.to) {
      setChanges((cs) => cs.map((x) => (x.id === id ? { ...x, stale: true } : x)));
      return;
    }
    const end = c.kind === "complete" && textRef.current[c.end] === " " ? c.end + 1 : c.end;
    setChanges((cs) => cs.map((x) => (x.id === id ? { ...x, reverted: true, end: x.start + x.old.length } : x)));
    replaceText(c.start, end, c.old);
    if (c.kind !== "grammar") neverRef.current.add(c.old.toLowerCase());
    setHighlights((hs) => hs.filter((h) => h.id !== id));
    setStats((s) => ({ ...s, reverted: s.reverted + 1 }));
    if (c.kind !== "grammar") logClient({ kind: "reverted", old: c.old, to: c.to, changeKind: c.kind, lang: currentLang(textRef.current), left: textRef.current.slice(Math.max(0, c.start - 160), c.start), confidence: c.confidence });
    taRef.current?.focus();
  };

  /** Warm the function and open its outbound connection to Jev with one tiny request. */
  const prime = () => {
    fetch("/api/warm").catch(() => {});
    postJSON("/api/jev", { lang: "en", prefilter: { window: "This short sentence only warms the connection before the writer starts typing." } }).catch(() => {});
  };

  // ---------- the Jev bus ----------
  const scheduleBus = () => {
    const b = busRef.current;
    if (b.inflight >= MAX_INFLIGHT || b.timer || slotsEmpty(b.slots)) return;
    const wait = Math.max(0, b.lastSent + b.minGap - Date.now());
    b.timer = setTimeout(() => {
      b.timer = null;
      void sendBus();
    }, wait);
  };

  const sendBus = async () => {
    const b = busRef.current;
    if (b.inflight >= MAX_INFLIGHT || slotsEmpty(b.slots)) return;
    const slots = b.slots;
    b.slots = emptySlots();
    b.inflight += 1;
    b.lastSent = Date.now();
    setStats((s) => ({ ...s, jev: s.jev + 1 }));
    try {
      // Language: once the server has detected it, send it explicitly and re-detect on the whole document every 10th
      // request (or at once when Danish letters appear), which skips the detection work and the document payload.
      const cachedLang = langMode === "auto" ? serverLangRef.current : langMode;
      const probeNow = langMode === "auto" && (!cachedLang || langProbeRef.current >= 10 || (cachedLang === "en" && /[æøå]/i.test(textRef.current.slice(-200))));
      langProbeRef.current = probeNow ? 0 : langProbeRef.current + 1;
      const body = {
        client: "web",
        session: SESSION,
        lang: probeNow ? "auto" : cachedLang,
        doc: probeNow ? textRef.current.slice(0, 20000) : undefined,
        aggressiveness: aggr,
        tone,
        complete: slots.complete ? { partial: slots.complete.w.word, left: slots.complete.snap.text.slice(Math.max(0, slots.complete.w.start - 400), slots.complete.w.start) } : undefined,
        typos: [...slots.typos.values()].map((t) => ({ id: t.id, word: t.w.word, left: t.snap.text.slice(Math.max(0, t.w.start - 400), t.w.start) })),
        recheck: [...slots.recheck.values()].map((r) => ({ id: r.id, word: r.sp.word, alternatives: r.alternatives, left: r.snap.text.slice(Math.max(0, r.sp.start - 300), r.sp.start), right: r.right, completed: r.completed })),
        prefilter: slots.prefilter ? { window: slots.prefilter.text } : undefined,
      };
      const res = await postJSON<{
        lang?: Lang;
        detected?: { lang: Lang | null; en: number; da: number };
        complete?: { complete: boolean; to?: string; confidence?: number; addSpace?: boolean; family?: string[]; candidates?: string[] };
        typos?: { id: string; replace: boolean; to?: string; confidence?: number; foreign?: boolean; unresolved?: boolean }[];
        recheck?: { id: string; replace: boolean; to?: string; confidence?: number }[];
        prefilter?: { worth: number; callHaiku: boolean };
        ms?: number;
      }>("/api/jev", body);
      if (res.status === 429) {
        b.minGap = Math.min(6000, Math.round(b.minGap * 1.7));
        setStats((s) => ({ ...s, rateLimited: s.rateLimited + 1, gap: b.minGap }));
        // put back what is still relevant
        if (slots.complete && !b.slots.complete) b.slots.complete = slots.complete;
        for (const [k, v] of slots.typos) if (!b.slots.typos.has(k)) b.slots.typos.set(k, v);
        for (const [k, v] of slots.recheck) if (!b.slots.recheck.has(k)) b.slots.recheck.set(k, v);
        if (slots.prefilter && !b.slots.prefilter) b.slots.prefilter = slots.prefilter;
        return;
      }
      b.minGap = Math.max(60, Math.round(b.minGap * 0.8));
      if (res.ms) setStats((s) => ({ ...s, lastMs: res.ms!, gap: b.minGap }));
      if (res.lang) serverLangRef.current = res.lang;
      if (res.detected) setDetected(res.detected);

      // autocomplete: instant, plus a trailing space, then the completed word is committed
      if (slots.complete && res.complete?.complete && res.complete.to) {
        const { snap, w } = slots.complete;
        const r = relocate(w, snap.version);
        const ta = taRef.current;
        if (r && ta && textRef.current.slice(r.start, r.end) === w.word && ta.selectionStart === r.end && ta.selectionEnd === r.end && !neverRef.current.has(w.word.toLowerCase())) {
          const addSpace = res.complete.addSpace !== false;
          replaceText(r.start, r.end, res.complete.to + (addSpace ? " " : ""));
          const done = { start: r.start, end: r.start + res.complete.to.length };
          if (addSpace) swallowSpaceRef.current = versionRef.current;
          const changeId = nextId();
          setHighlights((hs) => [...hs, { ...done, id: changeId, kind: "complete", until: Date.now() + HIGHLIGHT_MS }]);
          setChanges((cs) => [{ ...done, id: changeId, old: w.word, to: res.complete!.to!, kind: "complete" as Kind, confidence: res.complete!.confidence ?? 0, at: Date.now(), reverted: false, alternatives: (res.complete!.family?.length ? res.complete!.family : (res.complete!.candidates ?? []).filter((c) => c.toLowerCase() !== res.complete!.to!.toLowerCase())).slice(0, 4) }, ...cs].slice(0, 300));
          frozenRef.current.push({ ...done, untilCommit: commitRef.current + 1 });
          undoArmedRef.current = { changeId, version: versionRef.current };
          setStats((s) => ({ ...s, completed: s.completed + 1 }));
          logClient({ kind: "applied", old: w.word, to: res.complete.to, changeKind: "complete", lang: currentLang(textRef.current), left: textRef.current.slice(Math.max(0, r.start - 160), r.start), confidence: res.complete.confidence });
          if (addSpace) onCommit({ text: textRef.current, caret: done.end + 1, version: versionRef.current }, done.end);
        }
      }
      for (const d of res.typos ?? []) {
        const slot = slots.typos.get(d.id);
        if (!slot) continue;
        if (d.foreign) {
          void translateWord(slot);
          continue;
        }
        if (d.replace && d.to) applyChange({ ...slot.w, old: slot.w.word, to: d.to, kind: "typo", confidence: d.confidence ?? 0, version: slot.snap.version });
        else if (d.unresolved && !unresolvedRef.current.has(d.id)) unresolvedRef.current.set(d.id, { snap: slot.snap, w: slot.w, commit: commitRef.current, tries: 0 });
      }
      for (const d of res.recheck ?? []) {
        const slot = slots.recheck.get(d.id);
        if (!slot || !d.replace || !d.to) continue;
        applyChange({ ...slot.sp, old: slot.sp.word, to: d.to, kind: "recheck", confidence: d.confidence ?? 0, version: slot.snap.version });
      }
      if (slots.prefilter && res.prefilter) {
        setStats((s) => ({ ...s, cWorth: res.prefilter!.worth }));
        if (res.prefilter.callHaiku) runHaiku(slots.prefilter);
      }
    } catch {
    } finally {
      b.inflight -= 1;
      scheduleBus();
    }
  };

  const runResolve = async () => {
    if (resolveInflightRef.current || unresolvedRef.current.size === 0) return;
    const h = healthRef.current;
    if (h?.anthropic && !h.anthropic.configured) return;
    const text = textRef.current;
    const ready: { id: string; entry: { snap: Snapshot; w: Span; commit: number; tries: number }; r: Range }[] = [];
    for (const [id, entry] of unresolvedRef.current) {
      const r = relocate(entry.w, entry.snap.version);
      if (!r || text.slice(r.start, r.end) !== entry.w.word || entry.tries >= 3 || neverRef.current.has(entry.w.word.toLowerCase())) {
        unresolvedRef.current.delete(id);
        continue;
      }
      const after = text.slice(r.end, r.end + 200);
      const wordsAfter = (after.match(/[\p{L}'’-]+/gu) ?? []).length;
      const sentenceEnded = /[.!?\n]/.test(after);
      if (wordsAfter >= 2 || sentenceEnded) ready.push({ id, entry, r });
    }
    if (!ready.length) return;
    resolveInflightRef.current = true;
    try {
      setStats((s) => ({ ...s, haiku: s.haiku + 1 }));
      const version = versionRef.current;
      const res = await postJSON<{ decisions: { id: string; replace: boolean; to?: string; confidence: number }[] }>("/api/resolve", {
        items: ready.map(({ id, entry, r }) => ({ id, word: entry.w.word, left: text.slice(Math.max(0, r.start - 300), r.start), right: text.slice(r.end, r.end + 200) })),
        lang: currentLang(text),
        aggressiveness: aggr,
      });
      for (const { id, entry, r } of ready) {
        entry.tries += 1;
        const d = (res.decisions ?? []).find((x) => x.id === id);
        if (d?.replace && d.to) {
          applyChange({ ...r, old: entry.w.word, to: d.to, kind: "context", confidence: d.confidence, version, note: "resolved with later context" });
          unresolvedRef.current.delete(id);
        }
      }
    } catch {
    } finally {
      resolveInflightRef.current = false;
    }
  };

  const translateWord = async (slot: TypoSlot) => {
    try {
      setStats((s) => ({ ...s, haiku: s.haiku + 1 }));
      const res = await postJSON<{ replace: boolean; to?: string; confidence?: number; kind?: string }>("/api/decide", {
        word: slot.w.word,
        left: slot.snap.text.slice(Math.max(0, slot.w.start - 600), slot.w.start),
        doc: textRef.current.slice(0, 20000),
        lang: langMode,
        aggressiveness: aggr,
        translate: true,
      });
      if (res.replace && res.to && res.kind === "translate") applyChange({ ...slot.w, old: slot.w.word, to: res.to, kind: "translate", confidence: res.confidence ?? 0, version: slot.snap.version });
    } catch {}
  };

  const runHaiku = (job: { snap: Snapshot; winStart: number; text: string }) => {
    const st = passCRef.current;
    if (st.inflight) {
      st.dirty = job;
      return;
    }
    const go = async (j: { snap: Snapshot; winStart: number; text: string }) => {
      st.inflight = true;
      try {
        setStats((s) => ({ ...s, haiku: s.haiku + 1 }));
        const res = await postJSON<{ approved: { original: string; offset: number; to: string; confidence: number; reason: string; kind?: string }[] }>("/api/propose", {
          window: j.text,
          lang: currentLang(j.snap.text),
          aggressiveness: aggr,
          tone,
          skipPrefilter: true,
        });
        const lastTwo = wordsBefore(j.snap.text, j.snap.caret, 2);
        // Apply in text order and never two rewrites within ~4 words of each other in one batch: each proposal was
        // judged alone, and adjacent rewrites can combine into an ungrammatical sentence.
        let lastEnd = -Infinity;
        for (const a of [...(res.approved ?? [])].sort((x, y) => x.offset - y.offset)) {
          const start = j.winStart + a.offset;
          const end = start + a.original.length;
          if (lastTwo.some((w) => overlaps(w, { start, end }))) continue;
          if (start - lastEnd < 24) continue;
          const kind: Kind = a.kind === "tone" ? "tone" : "context";
          if (applyChange({ start, end, old: a.original, to: a.to, kind, confidence: a.confidence, version: j.snap.version, note: a.reason, freezeFor: 12 })) lastEnd = start + a.to.length;
        }
      } catch {
      } finally {
        st.inflight = false;
        if (st.dirty) {
          const d = st.dirty;
          st.dirty = null;
          go(d);
        }
      }
    };
    go(job);
  };

  // ---------- events -> slots ----------
  const onCommit = (snap: Snapshot, boundaryIndex: number) => {
    commitRef.current += 1;
    frozenRef.current = frozenRef.current.filter((f) => f.untilCommit > commitRef.current);
    const b = busRef.current;
    b.slots.complete = undefined;
    const w = wordEndingAt(snap.text, boundaryIndex);
    if (!w) return;
    // typo slot; the common-typo table is applied locally and instantly, with no request
    const lang0 = currentLang(snap.text);
    const bareKey = w.word.replace(/^['’]+|['’]+$/g, "").toLowerCase();
    const lib = libraryRef.current;
    const learned = lib && !lib.never.includes(bareKey) ? lib.entries[bareKey] : undefined;
    const table = COMMON_TYPOS[lang0][bareKey] ?? (learned && (learned.lang === lang0 || !learned.lang) ? learned.to : undefined);
    if (table && w.start >= lockRef.current && !neverRef.current.has(w.word.toLowerCase())) {
      applyChange({ ...w, old: w.word, to: transferCase(w.word, table), kind: "typo", confidence: 0.99, version: snap.version, note: learned && !COMMON_TYPOS[lang0][bareKey] ? "learned" : undefined });
    } else if (w.start >= lockRef.current && !shouldSkip(w.word) && !neverRef.current.has(w.word.toLowerCase()) && !frozenRef.current.some((f) => f.untilCommit > commitRef.current && overlaps(f, w))) {
      const id = `${w.start}:${w.end}:${w.word}`;
      b.slots.typos.set(id, { id, snap, w });
      while (b.slots.typos.size > 10) b.slots.typos.delete(b.slots.typos.keys().next().value as string);
    }
    // re-check slots: confusables and recently changed words among the previous 4 words
    const lang = currentLang(snap.text);
    const conf = CONFUSABLES[lang];
    // Confusables are re-judged within the last 4 words; completed words within the last 8, because the ending
    // ("schedule" vs "scheduled") is often only settled by a later clause.
    const prev = wordsBefore(snap.text, w.start, 8);
    for (const [idx, sp] of prev.entries()) {
      if (sp.start < lockRef.current) continue;
      const lower = sp.word.toLowerCase();
      const own = changesRef.current.find((c) => !c.reverted && !c.stale && c.start === sp.start && c.end === sp.end);
      const withinFour = idx >= prev.length - 4;
      if (!withinFour && own?.kind !== "complete") continue;
      let alternatives: string[] | undefined = withinFour ? conf[lower] : undefined;
      if (own && own.kind !== "typo" && own.kind !== "complete") continue; // settled by context/tone/re-check already
      if (own) alternatives = own.kind === "complete" ? [...(own.alternatives ?? []), ...(alternatives ?? [])] : [own.old, ...(alternatives ?? [])];
      if (!alternatives?.length || neverRef.current.has(lower)) continue;
      const id = `${sp.start}:${sp.end}:${sp.word}`;
      b.slots.recheck.set(id, { id, snap, sp, alternatives: alternatives.slice(0, 3), right: snap.text.slice(sp.end, snap.caret), completed: own?.kind === "complete" });
    }
    while (b.slots.recheck.size > 8) b.slots.recheck.delete(b.slots.recheck.keys().next().value as string);
    // Haiku pre-filter: sentence ends or every third word (Haiku is the expensive call)
    const boundary = snap.text[boundaryIndex] ?? " ";
    commitsSinceCRef.current += 1;
    const h = healthRef.current;
    const haikuOk = !(h?.anthropic && !h.anthropic.configured);
    if (haikuOk && (/[.!?\n]/.test(boundary) || commitsSinceCRef.current >= (tone === "as-written" ? 5 : 3))) {
      commitsSinceCRef.current = 0;
      const win = windowBefore(snap.text, snap.caret);
      if (win.text.trim().split(/\s+/).length >= 6) b.slots.prefilter = { snap, winStart: win.start, text: win.text };
    }
    scheduleBus();
    void runResolve();
  };

  const onInput = () => {
    const ta = taRef.current!;
    let nt = ta.value;
    const ot = textRef.current;
    let p = 0;
    while (p < ot.length && p < nt.length && ot[p] === nt[p]) p++;
    let s = 0;
    while (s < ot.length - p && s < nt.length - p && ot[ot.length - 1 - s] === nt[nt.length - 1 - s]) s++;
    const removed = ot.length - p - s;
    const inserted = nt.slice(p, nt.length - s);
    textRef.current = nt;
    versionRef.current += 1;
    undoArmedRef.current = null;
    lastInputRef.current = Date.now();
    recordEdit({ p, removed, inserted: inserted.length, version: versionRef.current });
    setText(nt);
    if (!systemOnRef.current) return;

    // instant local grammar / spacing fixes for a single typed character
    if (inserted.length === 1 && removed === 0 && ta.selectionStart === p + 1 && p >= lockRef.current) {
      let pos = p;
      for (let round = 0; round < 3; round++) {
        const fix = grammarFix(nt, pos, currentLang(nt));
        if (!fix || fix.start < lockRef.current) break;
        if (true) {
        const old = nt.slice(fix.start, fix.end);
        const caretAfter = ta.selectionStart + (fix.to.length - (fix.end - fix.start));
        replaceText(fix.start, fix.end, fix.to, Math.max(fix.start, caretAfter));
        nt = textRef.current;
        const changeId = nextId();
        setChanges((cs) => [{ start: fix.start, end: fix.start + fix.to.length, id: changeId, old, to: fix.to, kind: "grammar" as Kind, confidence: 1, at: Date.now(), reverted: false, note: fix.note }, ...cs].slice(0, 300));
        if (fix.to.length) setHighlights((hs) => [...hs, { start: fix.start, end: fix.start + fix.to.length, id: changeId, kind: "grammar", until: Date.now() + HIGHLIGHT_MS }]);
        undoArmedRef.current = { changeId, version: versionRef.current };
        setStats((x) => ({ ...x, applied: x.applied + 1 }));
        p = Math.min(p, fix.start);
        pos = taRef.current!.selectionStart - 1; // the typed character's new position
        if (pos < 0 || nt[pos] !== inserted) break;
        }
      }
    }

    const caret = ta.selectionStart;
    // autocomplete slot while typing a word
    if (autocompleteRef.current && inserted.length === 1 && isWordChar(inserted) && caret > 0) {
      const w = wordEndingAt(nt, caret);
      if (w && w.start >= lockRef.current && w.word.length >= 2 && (w.end === nt.length || !isWordChar(nt[w.end])) && !shouldSkip(w.word) && !neverRef.current.has(w.word.toLowerCase()) && !frozenRef.current.some((f) => f.untilCommit > commitRef.current && overlaps(f, w))) {
        busRef.current.slots.complete = { snap: { text: nt, caret, version: versionRef.current }, w };
        scheduleBus();
      } else busRef.current.slots.complete = undefined;
    }
    // commit detection (small batched insertions are scanned for their last boundary; big pastes are not)
    if (inserted.length > 0 && inserted.length <= 64) {
      let k = inserted.length - 1;
      while (k >= 0 && isWordChar(inserted[k])) k--;
      if (k >= 0) {
        const idx = Math.min(nt.length - 1, p + k);
        if (idx > 0 && isWordChar(nt[idx - 1]) && !isWordChar(nt[idx])) onCommit({ text: nt, caret: idx + 1, version: versionRef.current }, idx);
      }
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (demoRef.current.running && !e.metaKey && !e.ctrlKey && e.key !== "Escape") stopDemo();
    if (e.key === " " && swallowSpaceRef.current === versionRef.current) {
      e.preventDefault();
      swallowSpaceRef.current = null;
      return;
    }
    if (e.key !== "Shift") swallowSpaceRef.current = null;
    if (e.key === "Backspace" && undoArmedRef.current && undoArmedRef.current.version === versionRef.current) {
      e.preventDefault();
      const id = undoArmedRef.current.changeId;
      undoArmedRef.current = null;
      revertChange(id);
    }
  };

  // ---------- demo ----------
  const stopDemo = () => {
    const d = demoRef.current;
    d.running = false;
    if (d.timer) clearTimeout(d.timer);
    d.timer = null;
    setDemoRunning(false);
    setDemoPhase("");
    setSystemOn(true);
  };
  const startDemo = () => {
    const ta = taRef.current;
    if (!ta) return;
    stopDemo();
    const d = demoRef.current;
    d.running = true;
    setDemoRunning(true);
    ta.focus();
    prime();
    const prefix = ta.value.length === 0 ? "" : ta.value.endsWith("\n\n") ? "" : ta.value.endsWith("\n") ? "\n" : "\n\n";
    // The whole demo runs with the system on: two paragraphs with planted mistakes.
    const script: Array<{ ch: string } | { cmd: "off" | "on" | "pause" }> = [
      { cmd: "on" },
      ...Array.from(prefix + DEMO_OFF + "\n\n" + DEMO_ON).map((ch) => ({ ch })),
    ];
    let i = 0;
    const typeChar = (ch: string) => {
      const el = taRef.current!;
      el.value = el.value + ch;
      el.setSelectionRange(el.value.length, el.value.length);
      onInput();
    };
    const step = () => {
      if (!d.running || !taRef.current) return;
      if (i >= script.length) {
        stopDemo();
        setTimeout(showNudge, 1500);
        return;
      }
      const item = script[i++];
      if ("cmd" in item) {
        if (item.cmd === "off") {
          setSystemOn(false);
          setDemoPhase("off");
          d.timer = setTimeout(step, 200);
        } else if (item.cmd === "on") {
          setSystemOn(true);
          setDemoPhase("on");
          prime();
          d.timer = setTimeout(step, 0);
        } else d.timer = setTimeout(step, 300);
        return;
      }
      const ch = item.ch;
      if (ch === "|") {
        if (!systemOnRef.current) {
          d.timer = setTimeout(step, 0);
          return;
        }
        // Completion detection: the word at the end of the text is no longer the partial (other changes elsewhere
        // do not count). Wait briefly only; a round-trip is ~300 ms.
        const partial = taRef.current.value.match(/[\p{L}'’-]+$/u)?.[0] ?? "";
        let restEnd = i;
        while (restEnd < script.length && "ch" in script[restEnd] && isWordChar((script[restEnd] as { ch: string }).ch)) restEnd++;
        const started = Date.now();
        const poll = () => {
          if (!d.running || !taRef.current) return;
          const v = taRef.current.value;
          const tail = v.match(/([\p{L}'’-]+)( ?)$/u);
          const completed = !!tail && tail[1].length > partial.length && tail[1].toLowerCase().startsWith(partial.toLowerCase());
          if (completed) {
            i = restEnd;
            if (tail![2] === " " && i < script.length && "ch" in script[i] && (script[i] as { ch: string }).ch === " ") i++;
            d.timer = setTimeout(step, 80);
          } else if (Date.now() - started > 800) d.timer = setTimeout(step, 0);
          else d.timer = setTimeout(poll, 40);
        };
        poll();
        return;
      }
      typeChar(ch);
      const pause = ch === "\n" ? 450 : /[.!?]/.test(ch) ? 320 : ch === "," ? 160 : ch === " " ? 65 : 38;
      d.timer = setTimeout(step, pause + Math.random() * 35);
    };
    step();
  };
  useEffect(() => () => stopDemo(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- overlay ----------
  const segments = useMemo(() => {
    type Seg = { start: number; end: number; hl?: Highlight };
    const marks = [...highlights].sort((a, b) => a.start - b.start);
    const out: Seg[] = [];
    let i = 0;
    for (const m of marks) {
      if (m.start < i) continue;
      if (m.start > i) out.push({ start: i, end: m.start });
      out.push({ start: m.start, end: m.end, hl: m });
      i = m.end;
    }
    if (i < text.length) out.push({ start: i, end: text.length });
    return out;
  }, [text, highlights]);

  const missingKeys = [health?.jev && !health.jev.configured ? "JEV" : null, health?.anthropic && !health.anthropic.configured ? "CLAUDE" : null].filter(Boolean) as string[];
  const dismissWelcome = () => {
    setShowWelcome(false);
    try {
      localStorage.setItem("ica_welcome_seen", "1");
    } catch {}
    taRef.current?.focus();
  };
  const kindLabel = (k: Kind) => (k === "recheck" ? "re-check" : k);

  return (
    <div className="app">
      <header className="topbar">
        <button className="burger" onClick={() => setDrawer(drawer === "left" ? null : "left")} aria-label="Settings and activity">☰</button>
        <div className="logo" aria-hidden>✎</div>
        <div className="titlebox">
          <input className="title" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Document title" />
          <div className="crumbs">Inline Contextual Autocorrect · saved locally · build {BUILD}</div>
        </div>
        <div className="topright">
          <button className={`sys ${systemOn ? "on" : "off"}`} onClick={() => setSystemOn(!systemOn)} title="Turn the whole system on or off">
            <i /> {systemOn ? "System ON" : "System OFF"}
          </button>
          <button className={`demo ${demoRunning ? "on" : ""}`} onClick={demoRunning ? stopDemo : startDemo} title="Types two paragraphs with planted mistakes while the system corrects them">
            {demoRunning ? "■ Stop demo" : "▶ Demo"}
          </button>
          <Dot ok={!!health?.jev?.ok} label="Jev" title={health?.jev?.note ?? "checking…"} />
          <Dot ok={!!health?.anthropic?.ok} label="Haiku" title={health?.anthropic?.note ?? "checking…"} />
          <div className={`dl ${dlOpen ? "open" : ""}`}>
            <button className="dlbtn" onClick={() => setDlOpen(!dlOpen)} aria-haspopup="menu" aria-expanded={dlOpen}>⤓ Download{release?.version ? ` v${release.version}` : ""}</button>
            {dlOpen && <DownloadMenu release={release} onClose={() => setDlOpen(false)} />}
          </div>
          <button className="ghost" onClick={() => setShowWelcome(true)} aria-label="How it works">?</button>
          <button className="burger right" onClick={() => setDrawer(drawer === "right" ? null : "right")} aria-label="Changes">
            ☰{changes.filter((c) => !c.reverted).length > 0 && <span className="badge">{changes.filter((c) => !c.reverted).length}</span>}
          </button>
        </div>
      </header>
      {drawer && <div className="drawer-bg" onClick={() => setDrawer(null)} />}

      {missingKeys.length > 0 && (
        <div className="banner">
          Missing environment variable{missingKeys.length > 1 ? "s" : ""}: <code>{missingKeys.join(", ")}</code>. Add them in Vercel → Project → Settings → Environment Variables and redeploy.
        </div>
      )}

      <main className="workspace">
        <aside className={`panel left ${drawer === "left" ? "open" : ""}`}>
          <button className="drawer-close" onClick={() => setDrawer(null)} aria-label="Close">×</button>
          <h2>Settings</h2>
          <label className="row">
            <span>Aggressiveness</span>
            <input type="range" min={0} max={1} step={0.05} value={aggr} onChange={(e) => setAggr(Number(e.target.value))} />
            <span className="val">{Math.round(aggr * 100)}</span>
          </label>
          <label className="row">
            <span>Tone</span>
            <select value={tone} onChange={(e) => setTone(e.target.value as Tone)}>
              {TONES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
          <p className="muted small hint">{TONES.find((t) => t.value === tone)?.hint}</p>
          <label className="row">
            <span>Autocomplete</span>
            <select value={autocomplete ? "1" : "0"} onChange={(e) => setAutocomplete(e.target.value === "1")}>
              <option value="0">Off (default)</option>
              <option value="1">On</option>
            </select>
          </label>
          <p className="muted small hint">Off: you finish every word yourself and half-typed mistakes are fixed once the word is done. On: Jev completes words it is sure about.</p>
          <label className="row">
            <span>Language</span>
            <select value={langMode} onChange={(e) => setLangMode(e.target.value as "auto" | Lang)}>
              <option value="auto">Auto ({currentLang(text)})</option>
              <option value="en">English</option>
              <option value="da">Dansk</option>
            </select>
          </label>
          <p className="muted small hint">
            {langMode === "auto"
              ? `Chosen by word count${detected ? ` (${detected.en} English, ${detected.da} Danish)` : ""}. Words from the other language are translated.`
              : langMode === "en"
                ? "Danish words you type are translated to English."
                : "Engelske ord du skriver oversættes til dansk."}
          </p>

          <h2 className="mt">Download the app</h2>
          <p className="muted small">Autocorrect everywhere you type, with the same corrections, chips and settings.</p>
          <DownloadMenu release={release} inline />

          <h2 className="mt">Activity</h2>
          <dl className="stats">
            <dt>Jev requests (batched)</dt><dd>{stats.jev}</dd>
            <dt>Haiku requests</dt><dd>{stats.haiku}</dd>
            <dt>Completed words</dt><dd>{stats.completed}</dd>
            <dt>Changes applied / reverted</dt><dd>{stats.applied + stats.completed} / {stats.reverted}</dd>
            <dt>Last round-trip</dt><dd>{stats.lastMs ? `${stats.lastMs} ms` : "–"}</dd>
            <dt>Send gap (adaptive)</dt><dd>{stats.gap} ms</dd>
            <dt>Rate-limited replies</dt><dd>{stats.rateLimited}</dd>
            <dt>Last pre-filter score</dt><dd>{stats.cWorth === null ? "–" : stats.cWorth.toFixed(2)}</dd>
            <dt>Jev host</dt><dd>{(health?.jev as { host?: string } | undefined)?.host ?? "–"}</dd>
            <dt>Server region</dt><dd>{health?.region ?? "–"}</dd>
          </dl>
        </aside>
        <section className="pagewrap">
          <div className="page">
            <textarea
              ref={taRef}
              className="editor"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              placeholder="Start typing, or press ▶ Demo."
              onInput={onInput}
              onKeyDown={onKeyDown}
              onCompositionStart={() => (undoArmedRef.current = null)}
            />
            <div className="overlay" aria-hidden>
              {segments.map((seg) => {
                const t = text.slice(seg.start, seg.end);
                if (seg.hl) return <span key={`h${seg.hl.id}`} className={`hl ${seg.hl.kind}`}>{t}</span>;
                return <span key={seg.start}>{t}</span>;
              })}
              {"\n"}
            </div>
          </div>
        </section>

        <aside className={`panel right ${drawer === "right" ? "open" : ""}`}>
          <button className="drawer-close" onClick={() => setDrawer(null)} aria-label="Close">×</button>
          <div className="panel-head">
            <h2>Changes</h2>
            <span className="count">{changes.filter((c) => !c.reverted).length}</span>
          </div>
          {changes.length === 0 && <p className="muted">Nothing changed yet. Every corrected, completed, translated or re-spaced word appears here with a revert button.</p>}
          <ul className="changes">
            {changes.slice(0, 120).map((c) => (
              <li key={c.id} className={c.reverted ? "reverted" : ""}>
                <div className="chg-main">
                  <span className="diff"><s>{showWs(c.old)}</s> <span className="arrow">→</span> <b>{showWs(c.to)}</b></span>
                  <span className="meta"><span className={`kind ${c.kind}`}>{kindLabel(c.kind)}</span>{c.note && <span className="note">{c.note}</span>}</span>
                </div>
                <div className="chg-side">
                  {!c.reverted && !c.stale && <button className="revert" onClick={() => revertChange(c.id)}>Revert</button>}
                  {c.reverted && <span className="muted small">reverted</span>}
                  {c.stale && !c.reverted && <span className="muted small">edited</span>}
                </div>
              </li>
            ))}
          </ul>
          <p className="muted small">Backspace right after a change undoes it. A reverted word is never touched again this session.</p>
        </aside>
      </main>

      {nudge && (
        <div className="nudge" role="dialog" aria-label="Download the app">
          <button className="nudge-x" onClick={dismissNudge} aria-label="Close">×</button>
          <div className="nudge-body">
            <b>Get this everywhere you type.</b>
            <span className="muted small">Same corrections, chips and settings as here, in every app on your computer or phone.</span>
          </div>
          <div className="nudge-actions">
            <button className="dlbtn big" onClick={() => { setDlOpen(true); dismissNudge(); window.scrollTo({ top: 0, behavior: "smooth" }); }}>⤓ Download the app</button>
          </div>
        </div>
      )}
      {showWelcome && (
        <div className="modal-bg" onClick={dismissWelcome}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="wt" onClick={(e) => e.stopPropagation()}>
            <h1 id="wt">Welcome to Inline Contextual Autocorrect</h1>
            <p>Write as you normally would. Everything runs while you type; nothing waits for you to pause, and every change is instant.</p>
            <ol>
              <li><b>Typo fix.</b> The word you just finished is checked against a dictionary; Jev picks the word you meant. Merged words like <i>ofcourse</i> are split, and words nothing can fix yet (<i>woyou</i>) are resolved a few words later from context.</li>
              <li><b>Re-check.</b> Each new word gives context to the words before it. Confusables like <i>their / there</i> and earlier fixes are re-judged.</li>
              <li><b>Spacing and punctuation.</b> Double spaces, spaces before commas, missing spaces after periods, brackets and quotes, capitals after a full stop: fixed locally the moment you type them.</li>
              <li><b>Translation.</b> A word from the other language (English ↔ Danish) is translated in place. The document language is chosen by counting your words, or set it in Settings.</li>
              <li><b>Better word in context.</b> Claude Haiku proposes a word that is clearly wrong for the meaning or clashes with your chosen tone; Jev approves or rejects each proposal.</li>
            </ol>
            <p>Changed words are <span className="demo-hl">highlighted</span> for a few seconds and listed in the sidebar with a <b>Revert</b> button. <kbd>Backspace</kbd> right after a change undoes it.</p>
            <p>Press <b>▶ Demo</b> to watch two paragraphs with planted mistakes being typed and corrected live. Pick a tone in Settings first (for example Formal) and the demo's casual words get replaced too, tagged <span className="kind tone">tone</span>.</p>
            <p className="muted small">Text windows are sent to the Jev and Anthropic APIs for decisions. Your document is stored only in this browser.</p>
            <button className="primary" onClick={dismissWelcome} autoFocus>Start writing</button>
          </div>
        </div>
      )}
    </div>
  );
}

function DownloadMenu({ release, onClose, inline }: { release: Release | null; onClose?: () => void; inline?: boolean }) {
  const a = release?.assets ?? {};
  const items = [
    { key: "darwin-arm64", label: "macOS · Apple silicon (M1–M4)", hint: "zip", paused: true },
    { key: "darwin-x64", label: "macOS · Intel", hint: "zip", paused: true },
    { key: "win32-x64", label: "Windows · 64-bit", hint: "zip, portable", paused: true },
    { key: "android", label: "Android · keyboard (GrapheneOS)", hint: "apk" },
  ];
  return (
    <div className={`dlmenu ${inline ? "inline" : ""}`} role="menu" onMouseLeave={onClose}>
      {items.map((it) => {
        // Desktop downloads are paused while the in-app typing is being fixed; installed apps keep updating.
        const url = it.paused ? undefined : a[it.key];
        return url ? (
          <a key={it.key} href={url} role="menuitem" onClick={onClose}>
            <span>{it.label}</span>
            <small>{it.hint}</small>
          </a>
        ) : (
          <span key={it.key} className="soon" role="menuitem" aria-disabled>
            <span>{it.label}</span>
            <small>{it.paused ? "paused, back soon" : "coming soon"}</small>
          </span>
        );
      })}
      <p className="muted small">
        Android/GrapheneOS: install the APK, then Settings → System → Keyboard → enable “Inline Autocorrect keyboard” and pick it. macOS (the app is not notarised): unzip, open the app once and dismiss the warning, then System Settings → Privacy &amp; Security → scroll down → <b>Open Anyway</b>. Then allow Accessibility and Input Monitoring when asked. Windows: unzip and run the exe (SmartScreen: More info → Run anyway).
        {release?.library ? ` Library: ${release.library.count} learned corrections.` : ""}
      </p>
    </div>
  );
}

function Dot({ ok, label, title }: { ok: boolean; label: string; title: string }) {
  return (
    <span className={`dot ${ok ? "ok" : "bad"}`} title={title}>
      <i /> {label}
    </span>
  );
}
