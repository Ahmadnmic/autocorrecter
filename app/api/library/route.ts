// Serves the learned corrections library to clients (web, desktop, Android).
import { NextResponse } from "next/server";
import { loadLibrary, withAbbreviations } from "@/lib/library";
import { applyProfile, deviceId, loadProfile } from "@/lib/profile";
import { EXPANDS_SHORTHAND, SHORTHAND } from "@/lib/abbreviations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const device = deviceId(new URL(req.url).searchParams.get("device"));
  const [lib, profile] = await Promise.all([loadLibrary(), loadProfile(device)]);
  const out = applyProfile(withAbbreviations(lib), profile);
  // Shorthand travels separately: the client applies it only when its tone asks for it, with no refetch on change.
  return NextResponse.json({ ...out, shorthand: SHORTHAND, shorthandTones: [...EXPANDS_SHORTHAND], profile: profile ? { never: profile.never.length, entries: Object.keys(profile.entries).length, updatedAt: profile.updatedAt } : null }, { headers: { "cache-control": device ? "private, max-age=60" : "public, max-age=60" } });
}
