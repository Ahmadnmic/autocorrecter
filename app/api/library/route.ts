// Serves the learned corrections library to clients (web, desktop, Android).
import { NextResponse } from "next/server";
import { loadLibrary, withAbbreviations } from "@/lib/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const lib = await loadLibrary();
  return NextResponse.json(withAbbreviations(lib), { headers: { "cache-control": "public, max-age=60" } });
}
