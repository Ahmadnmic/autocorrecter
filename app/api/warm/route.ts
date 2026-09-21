// Pre-loads dictionaries and frequency lists so the first real request on this instance is fast.
import { NextResponse } from "next/server";
import { getSpeller } from "@/lib/spell";
import { completions } from "@/lib/freq";
import { checkCron, rateLimit } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Cron calls carry the secret; the web page may also call this on load (no model calls, just dictionary
  // loading), so anonymous calls are allowed under a tight per-IP limit.
  if (checkCron(req)) {
    const limited = rateLimit(req, "warm", 6, 3);
    if (limited) return limited;
  }
  const t0 = Date.now();
  // Danish Hunspell is loaded lazily (only for Danish text), so warming it here would cost seconds for nothing.
  await Promise.all([getSpeller("en"), completions("th", "en", 1), completions("de", "da", 1)]);
  return NextResponse.json({ warm: true, ms: Date.now() - t0 });
}
