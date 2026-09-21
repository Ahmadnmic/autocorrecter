// Desktop release manifest plus the library counter that drives "50 new corrections" update prompts.
// `signed.manifest` is the exact manifest text and `signed.signature` its Ed25519 signature (see desktop/build.mjs);
// the desktop updater only trusts what it can verify against the public key compiled into it.
import { NextResponse } from "next/server";
import { loadLibrary } from "@/lib/library";
import { manifest, signature } from "@/lib/desktop-release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Asset = string | { url: string; sha256: string; size: number };
type Manifest = { version: string; notes?: string; assets: Record<string, Asset> };

export async function GET() {
  const lib = await loadLibrary();
  const rel = JSON.parse(manifest) as Manifest;
  // Plain URLs for the website's download menu; the full signed manifest for the apps.
  const assets = Object.fromEntries(Object.entries(rel.assets).map(([k, v]) => [k, typeof v === "string" ? v : v.url]));
  return NextResponse.json({ version: rel.version, notes: rel.notes, assets, library: { version: lib.version, count: lib.count, updatedAt: lib.updatedAt }, signed: { manifest, signature } }, { headers: { "cache-control": "public, max-age=60" } });
}
