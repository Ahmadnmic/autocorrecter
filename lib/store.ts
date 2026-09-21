// Two Blob stores: the public one holds what anyone may read (download archives, the corrections library);
// the private one holds everything derived from user text (event logs, learn state, feedback). Private blobs
// are only readable with the token, so a leaked URL reveals nothing.
import { del, get, list, put, type ListBlobResult } from "@vercel/blob";

export const privateToken = () => process.env.BLOB_PRIVATE_READ_WRITE_TOKEN || "";
export const privateEnabled = () => !!privateToken();

export function putPrivate(pathname: string, body: string, opts: { overwrite?: boolean } = {}) {
  return put(pathname, body, { access: "private", token: privateToken(), addRandomSuffix: !opts.overwrite, allowOverwrite: !!opts.overwrite, contentType: "application/json" });
}
export async function readPrivateJson<T>(urlOrPathname: string): Promise<T | null> {
  try {
    const r = await get(urlOrPathname, { access: "private", token: privateToken(), useCache: false });
    if (!r || r.statusCode !== 200) return null;
    return (await new Response(r.stream).json()) as T;
  } catch {
    return null;
  }
}
export function listPrivate(opts: { prefix: string; limit?: number; cursor?: string }): Promise<ListBlobResult> {
  return list({ ...opts, token: privateToken() });
}
export function delPrivate(urls: string[]) {
  return urls.length ? del(urls, { token: privateToken() }) : Promise.resolve();
}
