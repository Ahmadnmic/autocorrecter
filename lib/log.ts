// Event log for later analysis and for the learning job. Every API decision and every client outcome
// (applied, reverted, resolved late) is written as one small JSON blob under logs/<day>/. Writes are queued
// and flushed with waitUntil so they never delay a response.
import { put } from "@vercel/blob";
import { waitUntil } from "@vercel/functions";

export type LogEvent = {
  t: string; // ISO time
  route: string; // jev | decide | propose | resolve | complete | client
  kind?: string;
  ms?: number;
  lang?: string;
  client?: string; // web | desktop | android
  session?: string;
  in?: unknown;
  out?: unknown;
};

export function logEnabled(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

let seq = 0;
export function logEvent(e: Omit<LogEvent, "t">): void {
  if (!logEnabled()) return;
  const ev: LogEvent = { t: new Date().toISOString(), ...e };
  const day = ev.t.slice(0, 10);
  const name = `logs/${day}/${Date.now().toString(36)}-${(seq++).toString(36)}-${e.route}.json`;
  const body = JSON.stringify(ev);
  const p = put(name, body, { access: "public", addRandomSuffix: true, contentType: "application/json" }).catch(() => {});
  try {
    waitUntil(p);
  } catch {
    void p;
  }
}

/** Strip anything that looks like a secret or an email before it is logged. */
export function scrub(s: string): string {
  return s
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>")
    .replace(/\b(?:sk|jv|jev|vercel_blob_rw)_[A-Za-z0-9_-]{8,}\b/g, "<key>")
    .replace(/\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/g, "<card>");
}
