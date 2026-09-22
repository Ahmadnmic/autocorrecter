// Per-device writing profile, learned from that device's own outcomes: words the writer reverted (never touch again
// on this device) and corrections the writer kept more than once (apply instantly). Built by the learning job,
// stored privately, merged on top of the shared library when a client identifies itself with its device id.
import { readPrivateJson, putPrivate } from "./store";
import type { Library, LibraryEntry } from "./library";

export type Profile = { device: string; updatedAt: string; never: string[]; entries: Record<string, LibraryEntry>; events: number };

const cache = new Map<string, { at: number; p: Profile | null }>();
export const deviceId = (v: unknown): string => (typeof v === "string" ? v.replace(/[^A-Za-z0-9-]/g, "").slice(0, 32) : "");

export async function loadProfile(device: string, maxAgeMs = 60_000): Promise<Profile | null> {
  if (!device) return null;
  const c = cache.get(device);
  if (c && Date.now() - c.at < maxAgeMs) return c.p;
  const p = await readPrivateJson<Profile>(`profiles/${device}.json`).catch(() => null);
  cache.set(device, { at: Date.now(), p });
  return p;
}

export async function saveProfile(p: Profile): Promise<void> {
  await putPrivate(`profiles/${p.device}.json`, JSON.stringify(p), { overwrite: true });
  cache.set(p.device, { at: Date.now(), p });
}

/** The library as this device sees it: personal entries on top, personal never-list added. */
export function applyProfile(lib: Library, p: Profile | null): Library {
  if (!p) return lib;
  const ready = Object.fromEntries(Object.entries(p.entries).filter(([, e]) => e.n >= 2));
  return { ...lib, entries: { ...lib.entries, ...ready }, never: [...new Set([...lib.never, ...p.never])] };
}
