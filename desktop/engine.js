// Keystroke-buffer correction engine. Platform independent: it receives characters/keys and asks a `typer`
// to apply corrections (backspace N, type text). All decisions come from the web app's API routes.
"use strict";
const text = require("./vendor/text.js");
const { grammarFix } = require("./vendor/grammar.js");

// How far back from the caret a keystroke-based typer may edit (it moves the caret there and back). An atomic typer
// (Accessibility replace) edits in place, so it may reach the whole window.
const MAX_TAIL = 48; // decision-time bound for a keystroke typer (the word just typed, at most)
const MAX_TAIL_CONTEXT = 90;
const MAX_TAIL_ATOMIC = 600;
const MAX_TAIL_KEYS = 8; // at apply time, a keystroke typer only ever touches the word just typed: no sweeping back

class Engine {
  /**
   * @param {object} o
   * @param {(c:{tail:number, old:string, to:string})=>Promise<boolean>} o.apply  replace `old`, `tail` chars before the caret, with `to`; false when the text is not where expected
   * @param {string} o.apiBase
   * @param {()=>{aggressiveness:number, lang:"auto"|"en"|"da", enabled:boolean}} o.settings
   * @param {(e:{old:string,to:string,kind:string})=>void} [o.onChange]
   * @param {(msg:string)=>void} [o.log]
   */
  constructor(o) {
    this.apply = o.apply;
    /** Optional: async () => boolean, true when the focused control is a password field (Windows UI Automation). */
    this.secureField = o.secureField || null;
    this.secureKnown = null; // null = not asked for this field yet
    this.apiBase = o.apiBase.replace(/\/$/, "");
    this.settings = o.settings;
    this.onChange = o.onChange || (() => {});
    this.log = o.log || (() => {});
    this.buf = ""; // text typed since the last reset, ending at the caret
    this.version = 0;
    this.applying = false;
    this.pendingKeys = [];
    this.never = new Set();
    this.unresolved = new Map(); // id -> {start, word, tries}
    this.changes = []; // {start,end,old,to,kind}
    this.lang = null;
    this.inflight = 0;
    this.langProbe = 0;
    this.library = { version: 0, count: 0, entries: {}, never: [] };
    this.session = Math.random().toString(36).slice(2, 10);
    this.wordsSinceContext = 0;
    this.contextInflight = false;
    this.lastContextWindow = "";
    this.logQueue = [];
    this.logTimer = null;
    this.lastKeyAt = 0;
    this.resetVersion = 0;
    this.chain = Promise.resolve(); // rewrites run one at a time, each re-validated against the current buffer
    this.refreshLibrary();
    setInterval(() => this.refreshLibrary(), 10 * 60 * 1000).unref?.();
  }

  async refreshLibrary() {
    try {
      const r = await fetch(this.apiBase + "/api/library", { cache: "no-store" });
      const lib = await r.json();
      if (lib && lib.entries) this.library = lib;
    } catch {}
  }

  logClient(ev) {
    // Never log context that could hold credentials: scrub e-mails and long digit/symbol tokens locally.
    const scrub = (t) => String(t || "").replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>").replace(/\S*\d\S*\d\S*/g, "<num>").replace(/\S{20,}/g, "<long>");
    if (ev.left) ev.left = scrub(ev.left);
    if (ev.right) ev.right = scrub(ev.right);
    if (/@/.test(ev.old || "") || /@/.test(ev.to || "")) return;
    this.logQueue.push(ev);
    if (this.logTimer) return;
    this.logTimer = setTimeout(() => {
      this.logTimer = null;
      const events = this.logQueue.splice(0, 50);
      if (!events.length) return;
      this.post("/api/log", { client: "desktop", session: this.session, events }).catch(() => {});
    }, 1500);
  }

  reset(reason) {
    if (this.buf) this.log(`reset (${reason})`);
    this.buf = "";
    this.version++;
    this.resetVersion = this.version;
    this.unresolved.clear();
    this.changes = [];
    this.secureKnown = null;
  }

  /** A printable character was typed. */
  char(ch) {
    if (this.applying) return;
    this.lastKeyAt = Date.now();
    this.buf += ch;
    if (this.buf.length > 600) this.buf = this.buf.slice(-400);
    this.version++;
    const s = this.settings();
    if (!s.enabled) return;
    const p = this.buf.length - 1;
    // grammar fixes limited to the tail we can rewrite
    const fix = grammarFix(this.buf, p, this.currentLang());
    if (fix && fix.start >= this.buf.length - 4) {
      const old = this.buf.slice(fix.start, fix.end);
      const tail = this.buf.slice(fix.end);
      this.rewrite(fix.start, old, fix.to, tail, "grammar");
      return this.afterBoundary(ch);
    }
    this.afterBoundary(ch);
  }

  /** True while the buffer looks like a credential or identifier rather than prose: one token, no spaces. */
  looksLikeSecret() {
    const b = this.buf;
    if (b.includes(" ")) return false;
    return /[@\d]/.test(b) || (/[^\p{L}\s'’-]/u.test(b) && b.length > 3);
  }

  afterBoundary(ch) {
    if (text.isWordChar(ch)) return;
    // Nothing is checked until the field clearly holds prose: a space must have been typed, or the boundary is a space.
    if (ch !== " " && !this.buf.includes(" ")) return;
    if (this.looksLikeSecret()) return;
    if (this.secureKnown) return;
    const w = text.wordEndingAt(this.buf, this.buf.length - 1);
    if (!w) return;
    if (/@/.test(w.word) || /@/.test(this.buf.slice(Math.max(0, w.start - 2), w.end + 2))) return; // e-mail addresses
    // First word in a field: ask the OS whether this is a password control before anything leaves the buffer.
    if (this.secureField && this.secureKnown === null) {
      const version = this.version;
      this.secureField().then((secure) => {
        this.secureKnown = !!secure;
        if (secure) return this.reset("secure field");
        if (this.version === version && this.buf.slice(w.start, w.end) === w.word) this.onCommit(w);
      }).catch(() => {});
      return;
    }
    if (this.secureKnown) return;
    this.onCommit(w);
  }

  backspace() {
    if (this.applying) return;
    this.lastKeyAt = Date.now();
    this.buf = this.buf.slice(0, -1);
    this.version++;
  }

  currentLang() {
    const s = this.settings();
    return s.lang === "auto" ? this.lang || text.detectLang(this.buf) : s.lang;
  }

  /** Rewrite [start, start+old.length) to `to`, keeping `tail` after it. Rewrites are queued and applied in order. */
  rewrite(start, old, to, tail, kind) {
    if (this.buf.slice(start, start + old.length) !== old) return Promise.resolve(false);
    if (this.buf.slice(start + old.length) !== tail) return Promise.resolve(false);
    const n = old.length + tail.length;
    if (n > this.maxTail(kind)) return Promise.resolve(false);
    const version = this.version;
    const run = this.chain.then(() => this.rewriteNow(start, old, to, kind, version)).catch(() => false);
    this.chain = run.then(() => undefined);
    return run;
  }

  maxTail(kind) {
    if (this.apply.atomic) return MAX_TAIL_ATOMIC;
    return kind === "context" || kind === "tone" ? MAX_TAIL_CONTEXT : MAX_TAIL;
  }

  async rewriteNow(start, old, to, kind, version) {
    // Can this field be edited in place (Accessibility / UI Automation)? Then no wait is needed: the exact range is
    // replaced atomically. Otherwise keystrokes are used, and only for the word just typed, during a real pause
    // in typing, so our keys never land between the user's own.
    let atomic = !!this.apply.atomic;
    if (atomic && this.apply.probe) atomic = await this.apply.probe();
    if (!atomic) {
      for (let waited = 0; Date.now() - this.lastKeyAt < 220 && waited < 2000; waited += 30) await new Promise((r) => setTimeout(r, 30));
      if (this.resetVersion > version) return false;
      if (this.buf.slice(start, start + old.length) !== old) return false;
      if (this.buf.length - (start + old.length) > MAX_TAIL_KEYS) {
        this.log(`skipped ${kind} "${old}": field has no in-place editing and the word is ${this.buf.length - (start + old.length)} chars back`);
        return false;
      }
    }
    if (this.resetVersion > version) return false; // the field changed (click, Enter, arrow) since this was decided
    if (this.buf.slice(start, start + old.length) !== old) return false;
    const tail = this.buf.slice(start + old.length);
    if (old.length + tail.length > (atomic ? MAX_TAIL_ATOMIC : MAX_TAIL_KEYS)) return false;
    this.applying = true;
    try {
      const ok = await this.apply({ tail: tail.length, old, to, atomic });
      if (!ok) {
        this.log("apply refused: text not where expected, resetting");
        this.reset("desync");
        return false;
      }
      this.buf = this.buf.slice(0, start) + to + tail;
      this.version++;
      this.changes.push({ start, end: start + to.length, old, to, kind });
      this.onChange({ old, to, kind });
      if (kind !== "grammar") this.logClient({ kind: kind === "revert" ? "reverted" : kind === "resolved" ? "resolved" : "applied", old, to, changeKind: kind, lang: this.currentLang(), left: this.buf.slice(Math.max(0, start - 160), start), right: tail.slice(0, 120) });
      return true;
    } finally {
      this.applying = false;
    }
  }

  onCommit(w) {
    const s = this.settings();
    const lang = this.currentLang();
    const boundary = this.buf[w.end] || " ";
    const tailAfter = () => this.buf.slice(w.end);
    // 1. common typo table: local, instant
    const bare = w.word.replace(/^['’]+|['’]+$/g, "");
    const key = bare.toLowerCase();
    const learned = this.library.entries[key] && !this.library.never.includes(key) && (this.library.entries[key].lang === lang || !this.library.entries[key].lang) ? this.library.entries[key].to : null;
    const common = text.COMMON_TYPOS[lang][key] || learned;
    if (common && !this.never.has(w.word.toLowerCase())) {
      this.rewrite(w.start, w.word, text.transferCase(w.word, common), tailAfter(), "typo");
      this.resolveUnresolved();
      return;
    }
    // 2. batched Jev request: typo + confusable re-checks
    const typos = [];
    if (!text.shouldSkip(w.word) && !this.never.has(w.word.toLowerCase())) typos.push({ id: `${w.start}:${w.word}`, word: w.word, left: this.buf.slice(Math.max(0, w.start - 400), w.start), start: w.start });
    const recheck = [];
    const conf = text.CONFUSABLES[lang];
    const prev = text.wordsBefore(this.buf, w.start, 4);
    for (const sp of prev) {
      const lower = sp.word.toLowerCase();
      let alternatives = conf[lower];
      const own = this.changes.find((c) => c.kind === "typo" && c.start === sp.start && c.end === sp.end);
      if (own) alternatives = [own.old, ...(alternatives || [])];
      if (!alternatives || !alternatives.length || this.never.has(lower)) continue;
      recheck.push({ id: `${sp.start}:${sp.word}`, word: sp.word, alternatives: alternatives.slice(0, 3), left: this.buf.slice(Math.max(0, sp.start - 300), sp.start), right: this.buf.slice(sp.end), start: sp.start, end: sp.end });
    }
    // Context pass: every few words or at a sentence end, the batched request also asks Jev whether the recent
    // window holds a word that is wrong in context; only then Haiku proposes and Jev gates (same as the web app).
    this.wordsSinceContext++;
    const window = this.buf.slice(-600);
    const wantContext = !this.contextInflight && window !== this.lastContextWindow && window.trim().split(/\s+/).length >= 6 && (this.wordsSinceContext >= 4 || /[.!?]/.test(boundary));
    // The context pass runs alongside the batched call, not after it: the server's own pre-filter gates Haiku.
    if (wantContext) {
      this.wordsSinceContext = 0;
      this.lastContextWindow = window;
      this.contextInflight = true;
      this.contextPass(window, lang, s, true);
    }
    if (typos.length || recheck.length) this.sendJev(typos, recheck, s, lang);
    this.resolveUnresolved();
  }

  async sendJev(typos, recheck, s, lang) {
    const probe = s.lang === "auto" && (!this.lang || this.langProbe++ >= 10);
    if (probe) this.langProbe = 0;
    const body = {
      client: "desktop",
      session: this.session,
      lang: probe ? "auto" : lang,
      doc: probe ? this.buf.slice(-4000) : undefined,
      aggressiveness: s.aggressiveness,
      tone: s.tone || "as-written",
      typos: typos.map(({ id, word, left }) => ({ id, word, left })),
      recheck: recheck.map(({ id, word, alternatives, left, right }) => ({ id, word, alternatives, left, right })),
    };
    let res;
    try {
      this.inflight++;
      res = await this.post("/api/jev", body);
    } catch (e) {
      this.log(`jev error: ${e.message}`);
      return;
    } finally {
      this.inflight--;
    }
    if (res.lang) this.lang = res.lang;

    for (const d of res.typos || []) {
      const t = typos.find((x) => x.id === d.id);
      if (!t) continue;
      if (d.foreign) {
        this.translate(t, s, lang);
        continue;
      }
      if (d.replace && d.to) this.applyIfIntact(t.start, t.word, d.to, "typo");
      else if (d.unresolved && !this.unresolved.has(d.id)) this.unresolved.set(d.id, { start: t.start, word: t.word, tries: 0 });
    }
    for (const d of res.recheck || []) {
      const r = recheck.find((x) => x.id === d.id);
      if (r && d.replace && d.to) this.applyIfIntact(r.start, r.word, d.to, "recheck");
    }
  }

  /** Haiku proposes better words for the window, Jev gates them; approved ones are applied where the text is intact. */
  async contextPass(window, lang, s, prefilter = false) {
    try {
      const res = await this.post("/api/propose", { window, lang, aggressiveness: s.aggressiveness, tone: s.tone || "as-written", skipPrefilter: !prefilter }, 9000);
      const approved = Array.isArray(res.approved) ? res.approved : [];
      this.log(`propose: ${res.proposed ?? 0} proposed, ${approved.length} approved${res.why ? ` (${res.why})` : ""}`);
      // Locate the window in the current buffer (text may have grown since); apply from the end so offsets hold.
      const anchor = window.slice(-80);
      const at = this.buf.lastIndexOf(anchor);
      if (at < 0) return this.log("propose: window no longer in buffer");
      const windowStart = at + anchor.length - window.length;
      for (const a of [...approved].sort((x, y) => y.offset - x.offset)) {
        if (!a || typeof a.original !== "string" || typeof a.to !== "string" || !(a.offset >= 0)) continue;
        const abs = windowStart + a.offset;
        if (abs < 0 || this.buf.slice(abs, abs + a.original.length) !== a.original) {
          this.log(`propose: "${a.original}" moved, skipped`);
          continue;
        }
        const ok = await this.applyIfIntact(abs, a.original, a.to, a.kind === "tone" ? "tone" : "context");
        if (!ok) this.log(`propose: "${a.original}" -> "${a.to}" not applied (too far back: ${this.buf.length - abs} chars, limit ${this.maxTail("context")})`);
      }
    } catch (e) {
      this.log(`propose error: ${e.message}`);
    } finally {
      this.contextInflight = false;
    }
  }

  async translate(t, s, lang) {
    try {
      const res = await this.post("/api/decide", { word: t.word, left: t.left, lang: s.lang === "auto" ? lang : s.lang, aggressiveness: s.aggressiveness, translate: true });
      if (res.replace && res.to && res.kind === "translate") this.applyIfIntact(t.start, t.word, res.to, "translate");
    } catch (e) {
      this.log(`translate error: ${e.message}`);
    }
  }

  async resolveUnresolved() {
    if (this.resolving || !this.unresolved.size) return;
    const ready = [];
    for (const [id, u] of this.unresolved) {
      if (this.buf.slice(u.start, u.start + u.word.length) !== u.word || u.tries >= 3) {
        this.unresolved.delete(id);
        continue;
      }
      const after = this.buf.slice(u.start + u.word.length);
      const wordsAfter = (after.match(/[\p{L}'’-]+/gu) || []).length;
      if (wordsAfter >= 2 || /[.!?]/.test(after)) ready.push({ id, u, right: after });
    }
    if (!ready.length) return;
    this.resolving = true;
    try {
      const res = await this.post("/api/resolve", {
        items: ready.map(({ id, u, right }) => ({ id, word: u.word, left: this.buf.slice(Math.max(0, u.start - 300), u.start), right })),
        lang: this.currentLang(),
        aggressiveness: this.settings().aggressiveness,
      });
      for (const { id, u } of ready) {
        u.tries++;
        const d = (res.decisions || []).find((x) => x.id === id);
        if (d && d.replace && d.to) {
          if (await this.applyIfIntact(u.start, u.word, d.to, "resolved")) this.unresolved.delete(id);
        }
      }
    } catch (e) {
      this.log(`resolve error: ${e.message}`);
    } finally {
      this.resolving = false;
    }
  }

  /** Apply a replacement if the word is still where it was and the text after it is short enough to retype. */
  applyIfIntact(start, old, to, kind) {
    if (this.buf.slice(start, start + old.length) !== old) return Promise.resolve(false);
    if (this.never.has(old.toLowerCase())) return Promise.resolve(false);
    const tail = this.buf.slice(start + old.length);
    return this.rewrite(start, old, to, tail, kind);
  }

  async post(path, body, timeoutMs = 6000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(this.apiBase + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }
}

module.exports = { Engine };
