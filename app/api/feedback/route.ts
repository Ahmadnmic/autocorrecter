// Feature requests and feedback from the desktop apps. Stored in the private Blob store under feedback/.
// Reading the inbox needs the admin token:  GET /api/feedback?format=md  with  Authorization: Bearer $ADMIN_SECRET
import { NextResponse } from "next/server";
import { checkSecret, rateLimit, readJson, strHead, NO_STORE } from "@/lib/guard";
import { scrub } from "@/lib/log";
import { listPrivate, privateEnabled, putPrivate, readPrivateJson } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Item = { at: string; text: string; platform?: string; version?: string; contact?: string; status?: string };

export async function POST(req: Request) {
  const limited = rateLimit(req, "feedback", 6, 3);
  if (limited) return limited;
  const parsed = await readJson<Partial<Item>>(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.body;
  const text = strHead(body.text, 2000).trim();
  if (text.length < 3) return NextResponse.json({ ok: false, why: "empty" }, { status: 400 });
  if (!privateEnabled()) return NextResponse.json({ ok: false, why: "no_store" }, { status: 503 });
  // The contact field is the only place a user may leave an address on purpose; everything else is scrubbed.
  const item: Item = { at: new Date().toISOString(), text: scrub(text), platform: strHead(body.platform, 40).replace(/[^\w.-]/g, ""), version: strHead(body.version, 20).replace(/[^\w.-]/g, ""), contact: strHead(body.contact, 120).replace(/[\r\n<>]/g, ""), status: "new" };
  await putPrivate(`feedback/${item.at.replace(/[:.]/g, "-")}.json`, JSON.stringify(item));
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}

export async function GET(req: Request) {
  const denied = checkSecret(req, "ADMIN_SECRET");
  if (denied) return denied;
  if (!privateEnabled()) return NextResponse.json({ items: [] });
  const format = new URL(req.url).searchParams.get("format");
  const { blobs } = await listPrivate({ prefix: "feedback/", limit: 500 });
  const items = (await Promise.all(blobs.map((b) => readPrivateJson<Item>(b.url)))).filter((x): x is Item => !!x).sort((a, b) => (a.at < b.at ? 1 : -1));
  if (format === "md") {
    const md = ["# Feature requests and feedback", "", `${items.length} item(s). Newest first. Source: the desktop app's "Request a feature" button.`, "", ...items.map((i) => `## ${i.at.slice(0, 16).replace("T", " ")} · ${i.platform || "unknown"} ${i.version || ""}\n\n${i.text}\n${i.contact ? `\nContact: ${i.contact}\n` : ""}`)].join("\n");
    return new NextResponse(md, { headers: { "content-type": "text/markdown; charset=utf-8", ...NO_STORE } });
  }
  return NextResponse.json({ items }, { headers: NO_STORE });
}
