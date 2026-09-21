// Feature requests and feedback from the desktop apps. Stored in Blob under feedback/, listable as JSON or Markdown
// so a future working session can read the inbox: GET /api/feedback?format=md
import { NextResponse } from "next/server";
import { list, put } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Item = { at: string; text: string; platform?: string; version?: string; contact?: string; status?: string };

export async function POST(req: Request) {
  let body: Partial<Item>;
  try {
    body = (await req.json()) as Partial<Item>;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const text = String(body.text ?? "").trim().slice(0, 2000);
  if (text.length < 3) return NextResponse.json({ ok: false, why: "empty" }, { status: 400 });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return NextResponse.json({ ok: false, why: "no_store" }, { status: 503 });
  const item: Item = { at: new Date().toISOString(), text, platform: String(body.platform ?? "").slice(0, 40), version: String(body.version ?? "").slice(0, 20), contact: String(body.contact ?? "").slice(0, 120), status: "new" };
  await put(`feedback/${item.at.replace(/[:.]/g, "-")}.json`, JSON.stringify(item), { access: "public", addRandomSuffix: true, contentType: "application/json" });
  return NextResponse.json({ ok: true });
}

export async function GET(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return NextResponse.json({ items: [] });
  const format = new URL(req.url).searchParams.get("format");
  const { blobs } = await list({ prefix: "feedback/", limit: 500 });
  const items = (await Promise.all(blobs.map((b) => fetch(b.url).then((r) => r.json() as Promise<Item>).catch(() => null)))).filter((x): x is Item => !!x).sort((a, b) => (a.at < b.at ? 1 : -1));
  if (format === "md") {
    const md = ["# Feature requests and feedback", "", `${items.length} item(s). Newest first. Source: the desktop app's "Request a feature" button.`, "", ...items.map((i) => `## ${i.at.slice(0, 16).replace("T", " ")} · ${i.platform || "unknown"} ${i.version || ""}\n\n${i.text}\n${i.contact ? `\nContact: ${i.contact}\n` : ""}`)].join("\n");
    return new NextResponse(md, { headers: { "content-type": "text/markdown; charset=utf-8" } });
  }
  return NextResponse.json({ items });
}
