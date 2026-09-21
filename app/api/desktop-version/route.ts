// Desktop release manifest plus the library counter that drives "50 new corrections" update prompts.
import { NextResponse } from "next/server";
import { loadLibrary } from "@/lib/library";
import release from "@/desktop-release.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const lib = await loadLibrary();
  return NextResponse.json({ ...release, library: { version: lib.version, count: lib.count, updatedAt: lib.updatedAt } }, { headers: { "cache-control": "public, max-age=60" } });
}
