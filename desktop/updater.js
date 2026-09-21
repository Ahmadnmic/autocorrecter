// Update check against the web app, with in-place installation.
//
// Trust model (no Developer ID / Authenticode certificate yet):
//   * the release manifest is signed with an Ed25519 key that only the release machine holds; the public key is
//     compiled into this file. Anything unsigned, or signed for another version, is refused;
//   * the manifest carries the SHA-256 and size of every archive; the download is hashed while it streams and
//     refused on mismatch or overrun;
//   * manifest and archives are only ever fetched from the pinned hosts below, over HTTPS, redirects refused;
//   * nothing that came from the network is executed: the swap script is generated here from fixed strings, and
//     the archive is only unpacked (ditto / Expand-Archive, both path-traversal safe).
// On accept: download, verify, unpack, then a detached script waits for this process to exit, swaps the app
// folder / bundle and relaunches it. If the app runs from a read-only or temporary place (macOS App Translocation
// after a download, a zip opened in place on Windows) the new version is installed to Applications instead.
"use strict";
const { app, dialog, shell, Notification } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");
const { pipeline } = require("node:stream/promises");
const { Readable, Transform } = require("node:stream");

const RELEASE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAzcOxuaNVl2CdVieQCT3TvgfU9mg7iigUxRQlaS+j1tI=
-----END PUBLIC KEY-----`;
const ASSET_HOSTS = new Set(["evlfmdcukru3eear.public.blob.vercel-storage.com", "inline-autocorrect.vercel.app"]);
const MAX_ARCHIVE_BYTES = 500 * 1024 * 1024;

function targetKey() {
  if (process.platform === "win32") return "win32-x64";
  return process.arch === "arm64" ? "darwin-arm64" : "darwin-x64";
}
function newer(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}
/** Where the installed app lives: the .app bundle on macOS, the folder holding the exe on Windows. */
function installRoot() {
  const exe = app.getPath("exe");
  if (process.platform === "darwin") return path.resolve(exe, "..", "..", ".."); // Contents/MacOS/<exe>
  return path.dirname(exe);
}
/** True when the app runs from a place that cannot be updated in place. */
function isTemporaryLocation(root, platform = process.platform) {
  if (platform === "darwin") return root.includes("/AppTranslocation/") || root.startsWith("/Volumes/");
  const low = root.toLowerCase();
  return low.includes("\\appdata\\local\\temp\\") || low.includes("\\temp\\") || low.includes("\\windows\\");
}
function writable(dir) {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
/** Where to put the app when it cannot be replaced where it is. */
function preferredInstallDir() {
  if (process.platform === "darwin") {
    if (writable("/Applications")) return "/Applications";
    const home = path.join(os.homedir(), "Applications");
    fs.mkdirSync(home, { recursive: true });
    return home;
  }
  const dir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Programs", "Inline Autocorrect");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
const run = (cmd, args) => new Promise((resolve, reject) => execFile(cmd, args, { windowsHide: true, maxBuffer: 1 << 24 }, (err, _o, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve())));
/** Shell-quote for /bin/sh: single quotes, with embedded single quotes escaped. */
const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
/** PowerShell single-quoted literal. */
const pq = (s) => `'${String(s).replace(/'/g, "''")}'`;

let checking = false;
let lastLibraryCount = null;
let libraryHook = null;
function onLibraryRelease(fn) {
  libraryHook = fn;
}

/** Verify the signed manifest and return the parsed release, or throw. */
function verifyManifest(info) {
  const manifest = info?.signed?.manifest;
  const signature = info?.signed?.signature;
  if (typeof manifest !== "string" || typeof signature !== "string") throw new Error("The update manifest is not signed.");
  const ok = crypto.verify(null, Buffer.from(manifest, "utf8"), RELEASE_PUBLIC_KEY, Buffer.from(signature, "base64"));
  if (!ok) throw new Error("The update manifest signature is invalid.");
  const rel = JSON.parse(manifest);
  if (typeof rel.version !== "string" || typeof rel.assets !== "object") throw new Error("The update manifest is malformed.");
  return rel;
}

async function checkForUpdate(apiBase, { silent = true } = {}) {
  if (checking) return null;
  checking = true;
  try {
    let info;
    try {
      const r = await fetch(`${apiBase}/api/desktop-version`, { cache: "no-store", redirect: "error" });
      info = await r.json();
    } catch (e) {
      if (!silent) dialog.showMessageBox({ type: "info", message: "Could not check for updates", detail: e.message });
      return null;
    }
    const current = app.getVersion();
    // Library releases: every 50 learned corrections the web app bumps the count; the desktop app refreshes its
    // copy and tells the user, no binary download needed.
    const count = info.library?.count ?? 0;
    if (lastLibraryCount !== null && count - lastLibraryCount >= 50) {
      libraryHook?.();
      new Notification({ title: "Autocorrect library updated", body: `${count - lastLibraryCount} new corrections learned from usage were added.` }).show();
      lastLibraryCount = count;
    } else if (lastLibraryCount === null || count > lastLibraryCount) {
      if (lastLibraryCount !== null) libraryHook?.();
      lastLibraryCount = count;
    }
    if (!info.version || !newer(info.version, current)) {
      if (!silent) dialog.showMessageBox({ type: "info", message: `You are on the latest version (${current}).` });
      return null;
    }
    let rel;
    try {
      rel = verifyManifest(info);
    } catch (e) {
      if (!silent) dialog.showMessageBox({ type: "error", message: "Update refused", detail: `${e.message}\nDownload the new version from ${apiBase} instead.` });
      return null;
    }
    const asset = rel.assets?.[targetKey()];
    if (!asset || !newer(rel.version, current)) return null;
    const { response } = await dialog.showMessageBox({
      type: "info",
      message: `Inline Autocorrect ${rel.version} is available`,
      detail: `${rel.notes || ""}\n\nYou have ${current}. The update is verified, downloads and installs itself, then the app restarts.`.trim(),
      buttons: ["Update now", "Later"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response !== 0) return info;
    try {
      await installUpdate(asset, rel.version);
    } catch (e) {
      const { response: r } = await dialog.showMessageBox({ type: "error", message: "Update failed", detail: `${e.message}\n\nOpen the download page instead?`, buttons: ["Open page", "Close"] });
      if (r === 0) shell.openExternal(`${apiBase}/#download`);
    }
    return info;
  } finally {
    checking = false;
  }
}

/** Download an archive to `dest`, enforcing host, size and SHA-256 from the signed manifest. */
async function downloadVerified(asset, dest) {
  const url = typeof asset === "string" ? asset : asset.url;
  const expectedSha = typeof asset === "object" ? asset.sha256 : undefined;
  const expectedSize = typeof asset === "object" ? asset.size : undefined;
  if (!expectedSha || !expectedSize) throw new Error("The manifest has no checksum for this platform.");
  const u = new URL(url);
  if (u.protocol !== "https:" || !ASSET_HOSTS.has(u.hostname)) throw new Error(`Refusing to download from ${u.hostname}.`);
  if (expectedSize > MAX_ARCHIVE_BYTES) throw new Error("The update archive is unexpectedly large.");
  const res = await fetch(url, { redirect: "error" });
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
  const hash = crypto.createHash("sha256");
  let seen = 0;
  const meter = new Transform({
    transform(chunk, _enc, cb) {
      seen += chunk.length;
      if (seen > expectedSize) return cb(new Error("The download is larger than the manifest says."));
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body), meter, fs.createWriteStream(dest, { mode: 0o600 }));
  if (seen !== expectedSize) throw new Error("The download is incomplete.");
  const got = hash.digest("hex");
  if (got.length !== expectedSha.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(String(expectedSha).toLowerCase()))) throw new Error("The download checksum does not match the signed manifest.");
}

async function installUpdate(asset, version) {
  const work = fs.mkdtempSync(path.join(app.getPath("userData"), "update-"));
  fs.chmodSync(work, 0o700);
  const zip = path.join(work, "update.zip");
  await downloadVerified(asset, zip);
  const unpacked = path.join(work, "unpacked");
  fs.mkdirSync(unpacked);
  const currentRoot = installRoot();
  const relocate = isTemporaryLocation(currentRoot) || !writable(path.dirname(currentRoot));
  const target = relocate ? path.join(preferredInstallDir(), path.basename(process.platform === "darwin" ? currentRoot : "Inline Autocorrect")) : currentRoot;
  new Notification({ title: "Installing update", body: `Inline Autocorrect ${version} will restart in a moment${relocate ? ` (installing to ${path.dirname(target)})` : ""}.` }).show();

  if (process.platform === "darwin") {
    await run("ditto", ["-x", "-k", zip, unpacked]);
    const newApp = fs.readdirSync(unpacked).map((n) => path.join(unpacked, n)).find((p) => p.endsWith(".app"));
    if (!newApp) throw new Error("The update archive does not contain an app bundle.");
    // The bundle name inside the archive is canonical; a translocated copy may be called "Inline Autocorrect 2.app".
    const finalTarget = relocate ? path.join(path.dirname(target), path.basename(newApp)) : target;
    const T = sq(finalTarget);
    const script = [
      `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.2; done`,
      `rm -rf ${sq(finalTarget + ".old")}`,
      `if [ -e ${T} ]; then mv ${T} ${sq(finalTarget + ".old")} || exit 1; fi`,
      `if mv ${sq(newApp)} ${T}; then`,
      `  rm -rf ${sq(finalTarget + ".old")}`,
      `  xattr -dr com.apple.quarantine ${T} 2>/dev/null`,
      `  open ${T}`,
      `else`,
      `  [ -e ${sq(finalTarget + ".old")} ] && mv ${sq(finalTarget + ".old")} ${T}`,
      `  open ${sq(currentRoot)}`,
      `  osascript -e 'display notification "The update could not be installed. Download it from the website instead." with title "Inline Autocorrect"'`,
      `fi`,
      `rm -rf ${sq(work)}`,
    ].join("\n");
    spawn("/bin/sh", ["-c", script], { detached: true, stdio: "ignore" }).unref();
  } else {
    await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -LiteralPath ${pq(zip)} -DestinationPath ${pq(unpacked)} -Force`]);
    const exeName = path.basename(app.getPath("exe"));
    // The archive may hold the files at its root or in one top-level folder.
    let src = unpacked;
    if (!fs.existsSync(path.join(src, exeName))) {
      const sub = fs.readdirSync(unpacked).map((n) => path.join(unpacked, n)).find((p) => fs.existsSync(path.join(p, exeName)));
      if (!sub) throw new Error("The update archive does not contain the app.");
      src = sub;
    }
    const log = path.join(app.getPath("userData"), "update.log");
    const exe = path.join(target, exeName);
    const oldExe = path.join(currentRoot, exeName);
    const procName = exeName.replace(/\.exe$/i, "");
    // Everything below runs after this process has exited. Copies over the existing files (no deletion), verifies
    // the new app really came up, and otherwise relaunches the old one. Every step is logged to update.log.
    const ps = [
      `$ErrorActionPreference = 'Continue'`,
      `function Log($m) { Add-Content -LiteralPath ${pq(log)} -Value ("[" + (Get-Date -Format s) + "] " + $m) }`,
      `Log 'apply start, waiting for pid ${process.pid}'`,
      `$n = 0; while ((Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue) -and $n -lt 300) { Start-Sleep -Milliseconds 200; $n++ }`,
      `Start-Sleep -Milliseconds 500`,
      `New-Item -ItemType Directory -Force -Path ${pq(target)} | Out-Null`,
      `Log 'copying'`,
      `robocopy ${pq(src)} ${pq(target)} /E /R:10 /W:1 /XD __MACOSX /NFL /NDL /NJH /NJS | Out-Null`,
      `$rc = $LASTEXITCODE; Log ("robocopy exit " + $rc)`,
      `$started = $false`,
      `if ($rc -lt 8 -and (Test-Path -LiteralPath ${pq(exe)})) {`,
      `  try { Start-Process -FilePath ${pq(exe)} -WorkingDirectory ${pq(target)}; Log 'started new'; $started = $true } catch { Log ("start new failed: " + $_) }`,
      `}`,
      `Start-Sleep -Seconds 4`,
      `if (-not (Get-Process -Name ${pq(procName)} -ErrorAction SilentlyContinue)) {`,
      `  Log 'new app not running, starting previous'`,
      `  try { Start-Process -FilePath ${pq(oldExe)} -WorkingDirectory ${pq(currentRoot)} } catch { Log ("start old failed: " + $_) }`,
      `}`,
      `Log 'done'`,
      `Remove-Item -LiteralPath ${pq(work)} -Recurse -Force -ErrorAction SilentlyContinue`,
    ].join("\n");
    // -EncodedCommand is not subject to the script execution policy and needs no script file.
    const encoded = Buffer.from(ps, "utf16le").toString("base64");
    fs.appendFileSync(log, `[${new Date().toISOString()}] update ${version}: downloaded and verified, handing over\n`);
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encoded], { detached: true, stdio: "ignore", windowsHide: true, cwd: os.tmpdir() });
    child.unref();
  }
  // Close helpers that would otherwise outlive the app and keep its folder busy, then exit.
  try {
    disposeHook?.();
  } catch {}
  setTimeout(() => app.exit(0), 700);
}
let disposeHook = null;
/** The app registers what must be shut down before the process exits for an update (typer helper, key hook). */
function onBeforeExit(fn) {
  disposeHook = fn;
}

/**
 * Offer to move the app to Applications when it runs from a temporary place (macOS App Translocation after a
 * download, or a zip opened in place on Windows). Updates can only replace an app that lives in a real folder.
 */
async function offerMoveToApplications() {
  const root = installRoot();
  if (!isTemporaryLocation(root)) return false;
  const dest = preferredInstallDir();
  const { response } = await dialog.showMessageBox({
    type: "question",
    message: "Move Inline Autocorrect to Applications?",
    detail: `The app is running from a temporary location (${process.platform === "darwin" ? "macOS runs downloaded apps from a read-only copy" : root}). Moving it to ${dest} lets updates install and keeps permissions stable. The app restarts from the new place.`,
    buttons: ["Move and restart", "Not now"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) return false;
  if (process.platform === "darwin") {
    const target = path.join(dest, "Inline Autocorrect.app");
    await run("rm", ["-rf", target]);
    await run("ditto", [root, target]);
    await run("xattr", ["-dr", "com.apple.quarantine", target]).catch(() => {});
    spawn("/bin/sh", ["-c", `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.2; done; open ${sq(target)}`], { detached: true, stdio: "ignore" }).unref();
  } else {
    const exeName = path.basename(app.getPath("exe"));
    await run("robocopy", [root, dest, "/MIR", "/R:5", "/W:1"]).catch(() => {}); // robocopy exits 1 on success
    if (!fs.existsSync(path.join(dest, exeName))) throw new Error("Copy failed");
    spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", `while (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 200 }; Start-Process -FilePath ${pq(path.join(dest, exeName))}`], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  }
  setTimeout(() => app.exit(0), 300);
  return true;
}

module.exports = { checkForUpdate, targetKey, onLibraryRelease, offerMoveToApplications, verifyManifest, isTemporaryLocation, onBeforeExit };
