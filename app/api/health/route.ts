// Reports whether the two API keys are set and whether a minimal live call succeeds.
import { NextResponse } from "next/server";
import { jevConfigured, jevDecide, jevEndpointName, jevLimited } from "@/lib/jev";
import { checkSecret, rateLimit, NO_STORE } from "@/lib/guard";
import { anthropicConfigured } from "@/lib/haiku";
import { anthropicKey } from "@/lib/env";
import { getSpeller } from "@/lib/spell";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Status = { configured: boolean; ok: boolean; note: string; ms?: number; shape?: unknown };
let cached: { at: number; body: unknown } | null = null;

export async function GET(req: Request) {
  const limited = rateLimit(req, "health", 30, 10);
  if (limited) return limited;
  // Live probes cost model calls and reveal upstream details: admin only.
  const force = new URL(req.url).searchParams.get("force") === "1" && !checkSecret(req, "ADMIN_SECRET");
  if (cached && !force && Date.now() - cached.at < 60_000) return NextResponse.json(cached.body, { headers: NO_STORE });

  const spell: Status = { configured: true, ok: false, note: "" };
  try {
    const t = Date.now();
    const s = await getSpeller("en");
    spell.ok = s.correct("hello") && !s.correct("helol");
    spell.ms = Date.now() - t;
    spell.note = spell.ok ? "Hunspell en loaded" : "Hunspell answered unexpectedly";
  } catch (e) {
    spell.note = `dictionary load failed: ${(e as Error).message}`;
  }

  const jev: Status = { configured: jevConfigured(), ok: false, note: "" };
  if (!jev.configured) jev.note = "JEV_API_KEY not set";
  else if (!force) {
    jev.ok = true;
    jev.note = `configured via ${jevEndpointName()}${jevLimited() ? " (community key, low rate limit)" : ""}`;
  } else {
    try {
      const t = Date.now();
      const a = await jevDecide({ sentence: "I put the keys their." }, { wrong_word: { type: "noul", instructions: "Does the sentence contain a wrong word?" } }, 4000);
      jev.ms = Date.now() - t;
      jev.ok = typeof a.wrong_word.noul === "number";
      jev.note = jev.ok ? `live call ok via ${jevEndpointName()}, noul=${a.wrong_word.noul?.toFixed(2)}` : `live call via ${jevEndpointName()} returned an unrecognised shape`;
      jev.shape = a.wrong_word.raw;
    } catch (e) {
      jev.note = `live call failed: ${(e as Error).message}`;
    }
  }

  const anthropic: Status = { configured: anthropicConfigured(), ok: false, note: "" };
  if (!anthropic.configured) anthropic.note = "ANTHROPIC_API_KEY not set";
  else if (!force) {
    anthropic.ok = true;
    anthropic.note = "configured (live probe only with ?force=1)";
  } else {
    try {
      const t = Date.now();
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": anthropicKey(), "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-haiku-4-5", max_tokens: 5, messages: [{ role: "user", content: "Reply with OK" }] }),
        cache: "no-store",
      });
      anthropic.ms = Date.now() - t;
      anthropic.ok = res.ok;
      anthropic.note = res.ok ? "live call ok" : `HTTP ${res.status}: ${JSON.stringify(await res.json().catch(() => ({}))).slice(0, 200)}`;
    } catch (e) {
      anthropic.note = `live call failed: ${(e as Error).message}`;
    }
  }

  const body = { spell, jev: { ...jev, host: jevEndpointName(), limited: jevLimited() }, anthropic, region: process.env.VERCEL_REGION ?? "local", build: process.env.NEXT_PUBLIC_BUILD ?? "", at: new Date().toISOString() };
  cached = { at: Date.now(), body };
  return NextResponse.json(body, { headers: NO_STORE });
}
