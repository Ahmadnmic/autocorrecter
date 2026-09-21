// The global corrections library: what the system has learned from real usage.
// library/corrections.json = { version, count, updatedAt, entries: { [typed]: { to, n, lang } }, never: string[] }
// Built by /api/learn from the event log; consulted by /api/jev before any model call and fetched by clients.
import { list, put } from "@vercel/blob";

export type LibraryEntry = { to: string; n: number; lang: string; note?: string };
export type Library = { version: number; count: number; updatedAt: string; entries: Record<string, LibraryEntry>; never: string[] };

const PATH = "library/corrections.json";
let cache: { at: number; lib: Library } | null = null;

export const emptyLibrary = (): Library => ({ version: 0, count: 0, updatedAt: new Date(0).toISOString(), entries: {}, never: [] });

export async function loadLibrary(maxAgeMs = 60_000): Promise<Library> {
  if (cache && Date.now() - cache.at < maxAgeMs) return cache.lib;
  if (!process.env.BLOB_READ_WRITE_TOKEN) return emptyLibrary();
  try {
    const { blobs } = await list({ prefix: PATH, limit: 1 });
    if (!blobs.length) return (cache = { at: Date.now(), lib: emptyLibrary() }).lib;
    const res = await fetch(blobs[0].url, { cache: "no-store" });
    const lib = (await res.json()) as Library;
    cache = { at: Date.now(), lib };
    return lib;
  } catch {
    return cache?.lib ?? emptyLibrary();
  }
}

export async function saveLibrary(lib: Library): Promise<void> {
  await put(PATH, JSON.stringify(lib), { access: "public", addRandomSuffix: false, contentType: "application/json", allowOverwrite: true });
  cache = { at: Date.now(), lib };
}

/** Instant lookup: a learned correction for this typed word, unless the word was learned as "leave alone". */
export function lookup(lib: Library, typed: string): LibraryEntry | null {
  const k = typed.toLowerCase();
  if (lib.never.includes(k)) return null;
  return lib.entries[k] ?? null;
}
