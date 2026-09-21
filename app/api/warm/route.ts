// Pre-loads dictionaries and frequency lists so the first real request on this instance is fast.
import { NextResponse } from "next/server";
import { getSpeller } from "@/lib/spell";
import { completions } from "@/lib/freq";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const t0 = Date.now();
  // Danish Hunspell is loaded lazily (only for Danish text), so warming it here would cost seconds for nothing.
  await Promise.all([getSpeller("en"), completions("th", "en", 1), completions("de", "da", 1)]);
  return NextResponse.json({ warm: true, ms: Date.now() - t0 });
}
