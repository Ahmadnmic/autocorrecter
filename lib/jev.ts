import { aiGatewayKey, jevKey } from "./env";
// Server-only client for the Jev decision API (https://www.jevai.org/docs).
// Jev answers choice / noul / score questions over a `state` object. It never generates text.

export type JevQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string }
  | { type: "score"; instructions: string; criteria: string[] };

export type JevAnswer = {
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
  noul?: number;
  score?: string | number;
  raw: unknown;
};

// Three hosts serve the Jev model with the same request shape. Which one is used depends on the keys present:
//  - Vercel AI Gateway (AI_GATEWAY_API_KEY): https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe — billed via Vercel, high limits
//  - TypeSafe's official API (JEV key from console.typesafe.ai, ~1,200 req/min): https://docs.typesafe.ai/api
//  - The jevai.org community hub (JEV key starting with "jev_", ~10–20 req/min): https://www.jevai.org/docs
const ENDPOINTS = [
  { name: "vercel-gateway", url: "https://ai-gateway.vercel.sh/typesafe/v1/systemone", model: "typesafe-ai/jev", key: aiGatewayKey },
  { name: "typesafe", url: "https://api.typesafe.ai/v1/systemone", model: "jev-latest", key: jevKey },
  { name: "jevai.org", url: "https://www.jevai.org/api/v1/decisions", model: "typesafe-ai/jev", key: jevKey },
];
function initialEndpoint(): number {
  if (aiGatewayKey()) return 0;
  if (process.env.JEV_PROVIDER === "jevai" || /^jev_/.test(jevKey())) return 2;
  return 1;
}
let endpointIdx = initialEndpoint();
export function jevEndpointName() {
  return ENDPOINTS[endpointIdx].name;
}
/** True when only the low-rate community key is available. Callers then avoid optional Jev calls. */
export function jevLimited(): boolean {
  return !aiGatewayKey() && /^jev_/.test(jevKey());
}


export function jevConfigured(): boolean {
  return !!(aiGatewayKey() || jevKey());
}

export class JevError extends Error {
  constructor(message: string, public status?: number, public body?: unknown) {
    super(message);
  }
}

// Auth header styles tried in order on 401/403; the first that works is remembered for the instance.
const AUTH_STYLES: Array<(key: string) => Record<string, string>> = [
  (k) => ({ authorization: `Bearer ${k}` }),
  (k) => ({ "x-api-key": k }),
];
let authStyle = 0;

async function post(body: Record<string, unknown>, timeoutMs: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let res: Response | null = null;
    let json: unknown = {};
    outer: for (let e = 0; e < ENDPOINTS.length; e++) {
      const epIdx = (endpointIdx + e) % ENDPOINTS.length;
      const ep = ENDPOINTS[epIdx];
      const key = ep.key();
      if (!key) continue;
      for (let attempt = 0; attempt < AUTH_STYLES.length; attempt++) {
        const style = (authStyle + attempt) % AUTH_STYLES.length;
        res = await fetch(ep.url, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json", ...AUTH_STYLES[style](key) },
          body: JSON.stringify({ ...body, model: ep.model }),
          signal: ctrl.signal,
          cache: "no-store",
        });
        json = await res.json().catch(() => ({}));
        if (res.status !== 401 && res.status !== 403) {
          authStyle = style;
          endpointIdx = epIdx;
          break outer;
        }
      }
    }
    if (!res) throw new JevError("No Jev key configured", 503);
    return { res, json };
  } finally {
    clearTimeout(t);
  }
}

/** Ask Jev one or more questions. Returns an answer per question key. */
export async function jevDecide(
  state: Record<string, unknown>,
  questions: Record<string, JevQuestion>,
  timeoutMs = 1500,
): Promise<Record<string, JevAnswer>> {
  if (!jevConfigured()) throw new JevError("JEV_API_KEY is not set", 503);

  const { res, json } = await post({ state, questions }, timeoutMs);
  if (!res.ok) throw new JevError(`Jev HTTP ${res.status}: ${JSON.stringify(json).slice(0, 200)}`, res.status, json);

  const obj = (json ?? {}) as Record<string, unknown>;
  if (typeof obj.code === "number" && obj.code !== 0) {
    throw new JevError(`Jev error code ${obj.code}: ${String(obj.message ?? "")}`, 502, json);
  }

  const keys = Object.keys(questions);
  const holder = findAnswerHolder(obj, keys, 0) ?? {};
  const out: Record<string, JevAnswer> = {};
  for (const k of keys) out[k] = normalize(holder[k], questions[k]);
  return out;
}

function findAnswerHolder(node: unknown, keys: string[], depth: number): Record<string, unknown> | null {
  if (!node || typeof node !== "object" || depth > 4) return null;
  const rec = node as Record<string, unknown>;
  if (keys.every((k) => k in rec)) return rec;
  for (const v of Object.values(rec)) {
    const found = findAnswerHolder(v, keys, depth + 1);
    if (found) return found;
  }
  return null;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function normalize(raw: unknown, q: JevQuestion): JevAnswer {
  const a: JevAnswer = { raw };
  if (raw === null || raw === undefined) return a;
  if (typeof raw === "number") {
    if (q.type === "noul") a.noul = raw;
    else a.score = raw;
    return a;
  }
  if (typeof raw === "string") {
    if (q.type === "choice") a.choice = raw;
    else a.score = raw;
    return a;
  }
  const r = raw as Record<string, unknown>;
  const probs = (r.probabilities ?? r.distribution) as Record<string, number> | undefined;
  if (probs && typeof probs === "object") a.probabilities = probs;
  if (q.type === "choice") {
    a.choice = (r.choice ?? r.answer ?? r.value ?? r.selected) as string | undefined;
    a.confidence = num(r.confidence) ?? (a.choice && probs ? num(probs[a.choice]) : undefined);
    if (!a.choice && probs) {
      const best = Object.entries(probs).sort((x, y) => y[1] - x[1])[0];
      if (best) {
        a.choice = best[0];
        a.confidence = a.confidence ?? best[1];
      }
    }
  } else if (q.type === "noul") {
    a.noul = num(r.noul) ?? num(r.probability) ?? num(r.value) ?? num(r.yes);
    if (a.noul === undefined && probs) a.noul = num(probs.yes) ?? num(probs.true);
  } else {
    a.score = (r.score ?? r.value ?? r.level) as string | number | undefined;
    a.confidence = num(r.confidence);
  }
  return a;
}
