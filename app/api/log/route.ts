// Client outcome events: applied, reverted, resolved-late, cancelled. The ground truth for the learning job.
import { NextResponse } from "next/server";
import { logEvent, scrub } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ev = { kind: string; old?: string; to?: string; changeKind?: string; lang?: string; left?: string; right?: string; confidence?: number; source?: string };
type Body = { client?: string; session?: string; events: Ev[] };

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const events = (Array.isArray(body.events) ? body.events : []).slice(0, 50);
  for (const e of events) {
    logEvent({
      route: "client",
      kind: String(e.kind ?? "").slice(0, 32),
      lang: e.lang,
      client: String(body.client ?? "web").slice(0, 16),
      session: String(body.session ?? "").slice(0, 32),
      in: { old: scrub(String(e.old ?? "")).slice(0, 80), to: scrub(String(e.to ?? "")).slice(0, 80), changeKind: e.changeKind, left: scrub(String(e.left ?? "")).slice(-160), right: scrub(String(e.right ?? "")).slice(0, 120), confidence: e.confidence, source: e.source },
    });
  }
  return NextResponse.json({ ok: true, n: events.length });
}
