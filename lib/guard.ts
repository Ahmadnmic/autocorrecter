// Request guards shared by every API route: body size and shape, per-IP rate limits, a daily budget for the
// routes that call paid models, and constant-time secret checks for cron/admin endpoints.
//
// The limiter is in-memory per function instance. With Fluid compute one warm instance serves most traffic
// from a region, so it is an effective brake on scripted abuse; it is not an exact global quota. The Vercel WAF
// rate-limit rule (see docs/SECURITY.md) is the outer layer in front of it.
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const MAX_BODY_BYTES = 64 * 1024;

type Bucket = { tokens: number; at: number };
const buckets = new Map<string, Bucket>();
let sweepAt = Date.now();

/** Client address as seen by Vercel; falls back to a shared bucket when absent (local dev). */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const first = xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? (first || "local");
}

/**
 * Token bucket per (route, ip): `perMinute` requests sustained, bursts up to `burst`.
 * Returns null when allowed, or a 429 response.
 */
export function rateLimit(req: Request, route: string, perMinute: number, burst = perMinute): NextResponse | null {
  const now = Date.now();
  if (now - sweepAt > 120_000) {
    sweepAt = now;
    for (const [k, b] of buckets) if (now - b.at > 120_000) buckets.delete(k);
  }
  const key = `${route}:${clientIp(req)}`;
  const b = buckets.get(key) ?? { tokens: burst, at: now };
  b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 60_000) * perMinute);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "retry-after": "10", "cache-control": "no-store" } });
  }
  b.tokens -= 1;
  buckets.set(key, b);
  return null;
}

/** Daily cap on calls to paid model routes per instance; a stuck client or a script cannot run up the bill. */
const budget = { day: "", used: 0 };
export function spendBudget(cost = 1, dailyCap = Number(process.env.DAILY_MODEL_BUDGET ?? 20_000)): NextResponse | null {
  const day = new Date().toISOString().slice(0, 10);
  if (budget.day !== day) {
    budget.day = day;
    budget.used = 0;
  }
  if (budget.used + cost > dailyCap) return NextResponse.json({ error: "budget_exhausted" }, { status: 503, headers: { "retry-after": "3600", "cache-control": "no-store" } });
  budget.used += cost;
  return null;
}

/** Parse a JSON body with a hard size cap. Returns the value or a 4xx response. */
export async function readJson<T>(req: Request): Promise<{ body: T } | { error: NextResponse }> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) return { error: NextResponse.json({ error: "too_large" }, { status: 413 }) };
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return { error: NextResponse.json({ error: "bad_content_type" }, { status: 415 }) };
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { error: NextResponse.json({ error: "bad_body" }, { status: 400 }) };
  }
  if (text.length > MAX_BODY_BYTES) return { error: NextResponse.json({ error: "too_large" }, { status: 413 }) };
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) return { error: NextResponse.json({ error: "bad_json" }, { status: 400 }) };
    return { body: body as T };
  } catch {
    return { error: NextResponse.json({ error: "bad_json" }, { status: 400 }) };
  }
}

// ---- small validators: every field a client sends is coerced to a bounded, typed value or a default.
export const str = (v: unknown, max: number, def = ""): string => (typeof v === "string" ? (v.length > max ? v.slice(-max) : v) : def);
export const strHead = (v: unknown, max: number, def = ""): string => (typeof v === "string" ? v.slice(0, max) : def);
export const num = (v: unknown, min: number, max: number, def: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def);
export const oneOf = <T extends string>(v: unknown, allowed: readonly T[], def: T): T => (typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : def);
export const arr = <T>(v: unknown, max: number): T[] => (Array.isArray(v) ? (v.slice(0, max) as T[]) : []);
export const id = (v: unknown): string => strHead(v, 64).replace(/[^\w:.-]/g, "_");
/** A single token or short phrase as typed: no line breaks, bounded. */
export const word = (v: unknown, max = 64): string => strHead(v, max).replace(/[\r\n\t]/g, " ").trim();

/** Constant-time bearer check against an env secret; fails closed when the secret is not configured. */
export function checkSecret(req: Request, envName: string): NextResponse | null {
  const expected = process.env[envName];
  if (!expected) return NextResponse.json({ error: "not_configured", missing: envName }, { status: 503 });
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${expected}`;
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return null;
}

/** Vercel cron calls carry `Authorization: Bearer $CRON_SECRET`; an admin token is accepted too. */
export function checkCron(req: Request): NextResponse | null {
  const cron = checkSecret(req, "CRON_SECRET");
  if (!cron) return null;
  const admin = process.env.ADMIN_SECRET ? checkSecret(req, "ADMIN_SECRET") : cron;
  return admin ? cron : null;
}

export const NO_STORE = { "cache-control": "no-store" };
