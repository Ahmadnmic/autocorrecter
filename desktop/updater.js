// Update check against the web app, with in-place installation.
// On accept: download the zip, unpack it, then a detached script waits for this process to exit, swaps the app
// folder / bundle, and relaunches it. The correction logic itself lives in the web API, so most improvements
// arrive without an app update.
"use strict";
const { app, dialog, shell, Notification } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");
const { pipeline } = require("node:stream/promises");
const { Readable } = require("node:stream");

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
const run = (cmd, args) => new Promise((resolve, reject) => execFile(cmd, args, { windowsHide: true, maxBuffer: 1 << 24 }, (err, _o, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve())));

let checking = false;
let lastLibraryCount = null;
/** Called by the app with the engine so a library release can refresh it. */
let libraryHook = null;
function onLibraryRelease(fn) {
  libraryHook = fn;
}

async function checkForUpdate(apiBase, { silent = true } = {}) {
  if (checking) return null;
  checking = true;
  try {
    let info;
    try {
      const r = await fetch(`${apiBase}/api/desktop-version`, { cache: "no-store" });
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
    const asset = info.assets?.[targetKey()];
    if (!info.version || !asset || !newer(info.version, current)) {
      if (!silent) dialog.showMessageBox({ type: "info", message: `You are on the latest version (${current}).` });
      return null;
    }
    const { response } = await dialog.showMessageBox({
      type: "info",
      message: `Inline Autocorrect ${info.version} is available`,
      detail: `${info.notes || ""}\n\nYou have ${current}. The update downloads and installs itself, then the app restarts.`.trim(),
      buttons: ["Update now", "Later"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response !== 0) return info;
    try {
      await installUpdate(asset, info.version);
    } catch (e) {
      const { response: r } = await dialog.showMessageBox({ type: "error", message: "Update failed", detail: `${e.message}\n\nOpen the download page instead?`, buttons: ["Open page", "Close"] });
      if (r === 0) shell.openExternal(`${apiBase}/#download`);
    }
    return info;
  } finally {
    checking = false;
  }
}

async function installUpdate(assetUrl, version) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "ica-update-"));
  const zip = path.join(work, "update.zip");
  const res = await fetch(assetUrl);
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(zip));
  const unpacked = path.join(work, "unpacked");
  fs.mkdirSync(unpacked);
  const target = installRoot();
  new Notification({ title: "Installing update", body: `Inline Autocorrect ${version} will restart in a moment.` }).show();

  if (process.platform === "darwin") {
    await run("ditto", ["-x", "-k", zip, unpacked]);
    const newApp = fs.readdirSync(unpacked).map((n) => path.join(unpacked, n)).find((p) => p.endsWith(".app"));
    if (!newApp) throw new Error("The update archive does not contain an app bundle.");
    const script = `
      while kill -0 ${process.pid} 2>/dev/null; do sleep 0.2; done
      rm -rf "${target}.old"; mv "${target}" "${target}.old" && mv "${newApp}" "${target}" && rm -rf "${target}.old"
      xattr -dr com.apple.quarantine "${target}" 2>/dev/null
      open "${target}"; rm -rf "${work}"`;
    spawn("/bin/sh", ["-c", script], { detached: true, stdio: "ignore" }).unref();
  } else {
    await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${unpacked}' -Force`]);
    const exeName = path.basename(app.getPath("exe"));
    const ps = `
      while (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 200 }
      robocopy '${unpacked}' '${target}' /MIR /R:5 /W:1 | Out-Null
      Start-Process -FilePath '${path.join(target, exeName)}'
      Remove-Item -LiteralPath '${work}' -Recurse -Force -ErrorAction SilentlyContinue`;
    const scriptPath = path.join(work, "apply.ps1");
    fs.writeFileSync(scriptPath, ps);
    spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", scriptPath], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  }
  setTimeout(() => app.exit(0), 500);
}

module.exports = { checkForUpdate, targetKey, onLibraryRelease };
