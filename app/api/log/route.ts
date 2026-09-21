// Client outcome events: applied, reverted, resolved-late, cancelled. The ground truth for the learning job.
import { NextResponse } from "next/server";
import { logEvent, scrub } from "@/lib/log";
import { arr, num, oneOf, rateLimit, readJson, strHead, NO_STORE } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ev = { kind: string; old?: string; to?: string; changeKind?: string; lang?: string; left?: string; right?: string; confidence?: number; source?: string };
type Body = { client?: string; session?: string; events: Ev[] };

export async function POST(req: Request) {
  const limited = rateLimit(req, "log", 60, 30);
  if (limited) return limited;
  const parsed = await readJson<Body>(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.body;
  const events = arr<Partial<Ev>>(body.events, 50).filter((e) => e && typeof e === "object");
  for (const e of events) {
    logEvent({
      route: "client",
      kind: oneOf(e.kind, ["applied", "reverted", "resolved", "cancelled"] as const, "applied"),
      lang: oneOf(e.lang, ["en", "da"] as const, "en"),
      client: strHead(body.client, 16, "web").replace(/[^a-z-]/gi, ""),
      session: strHead(body.session, 32, "").replace(/[^a-z0-9-]/gi, ""),
      in: { old: scrub(strHead(e.old, 80)), to: scrub(strHead(e.to, 80)), changeKind: strHead(e.changeKind, 16), left: scrub(strHead(e.left, 400)).slice(-160), right: scrub(strHead(e.right, 200)).slice(0, 120), confidence: num(e.confidence, 0, 1, 0), source: strHead(e.source, 16) },
    });
  }
  return NextResponse.json({ ok: true, n: events.length }, { headers: NO_STORE });
}
