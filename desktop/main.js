"use strict";
const { app, Tray, Menu, BrowserWindow, nativeImage, ipcMain, screen, shell, systemPreferences, dialog, protocol } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { Engine } = require("./engine.js");
const { makeTyper } = require("./typer.js");
const { checkForUpdate, onLibraryRelease, offerMoveToApplications, onBeforeExit } = require("./updater.js");
const { detectLayout } = require("./keymap.js");
const { makeKeyHandler } = require("./hook.js");

const API_BASE = process.env.ICA_API_BASE || "https://inline-autocorrect.vercel.app";
const SETTINGS_FILE = () => path.join(app.getPath("userData"), "settings.json");
const defaults = { enabled: true, aggressiveness: 0.5, lang: "auto", tone: "as-written", overlay: true, overlayCorner: "bottom-right" };
const TONES = ["as-written", "neutral", "formal", "professional", "casual", "friendly", "academic", "concise"];
// Settings the renderer may change, with their validators. Anything else is ignored.
const SETTING_RULES = {
  enabled: (v) => typeof v === "boolean",
  aggressiveness: (v) => typeof v === "number" && v >= 0 && v <= 1,
  lang: (v) => ["auto", "en", "da"].includes(v),
  tone: (v) => TONES.includes(v),
  overlay: (v) => typeof v === "boolean",
  overlayCorner: (v) => ["bottom-right", "bottom-left", "top-right", "top-left"].includes(v),
  firstRun: (v) => typeof v === "boolean",
};
const UI_DIR = path.join(__dirname, "ui");
const WEB_PREFS = { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, navigateOnDragDrop: false };
// The two UI pages are served from the app's own scheme (app://ui/...) rather than file://: file:// has no usable
// origin for CSP or sender checks, and its extra privileges are switched off by a fuse in the packaged app.
const UI_ORIGIN = "app://ui";
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false } }]);
function registerUiScheme() {
  protocol.handle("app", async (req) => {
    try {
      const u = new URL(req.url);
      const rel = path.normalize(decodeURIComponent(u.pathname)).replace(/^[/\\]+/, "");
      const file = path.join(UI_DIR, rel);
      const ext = path.extname(file).toLowerCase();
      if (u.host !== "ui" || !file.startsWith(UI_DIR + path.sep) || !MIME[ext]) return new Response("not found", { status: 404 });
      const body = await fs.promises.readFile(file);
      return new Response(body, { headers: { "content-type": MIME[ext], "cache-control": "no-store" } });
    } catch {
      return new Response("not found", { status: 404 });
    }
  });
}
/** IPC is only accepted from our own two pages (top frame, served from the app scheme). */
function trustedSender(e) {
  const f = e.senderFrame;
  if (!f || f.parent !== null) return false;
  try {
    // Node's URL gives "null" as the origin of non-http schemes, so compare the parts; Chromium treats app://ui
    // as a standard origin, so no path or query can spoof it.
    const u = new URL(f.url);
    return u.protocol === "app:" && u.host === "ui";
  } catch {
    return false;
  }
}
let settings = { ...defaults };
let tray = null;
let settingsWin = null;
let overlayWin = null;
let engine = null;
let hookStarted = false;
const changes = []; // newest first, {id, old, to, kind, at, reverted}
const stats = { applied: 0, reverted: 0, jev: 0 };
let uiohook = null;
let UiohookKey = null;
let layout = "us";
let keyEvents = 0;
let startedAt = Date.now();
let lastKeyAt = 0;

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE(), "utf8"));
    settings = { ...defaults };
    for (const [k, rule] of Object.entries(SETTING_RULES)) if (rule(raw?.[k])) settings[k] = raw[k];
  } catch {}
}
function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 2));
  } catch {}
}

// ---------- overlay: colour-coded chips for each change, click-through, bottom-right ----------
function ensureOverlay() {
  if (overlayWin) return overlayWin;
  overlayWin = new BrowserWindow({
    width: 360,
    height: 260,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: WEB_PREFS,
  });
  overlayWin.setIgnoreMouseEvents(true);
  overlayWin.setAlwaysOnTop(true, "screen-saver");
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWin.loadURL(`${UI_ORIGIN}/overlay.html`);
  positionOverlay();
  overlayWin.on("closed", () => (overlayWin = null));
  return overlayWin;
}
function positionOverlay() {
  if (!overlayWin) return;
  const { workArea } = screen.getPrimaryDisplay();
  const [w, h] = overlayWin.getSize();
  const corner = settings.overlayCorner;
  const x = corner.endsWith("left") ? workArea.x + 12 : workArea.x + workArea.width - w - 12;
  const y = corner.startsWith("top") ? workArea.y + 12 : workArea.y + workArea.height - h - 12;
  overlayWin.setPosition(Math.round(x), Math.round(y));
}
function showChip(change) {
  if (!settings.overlay) return;
  const win = ensureOverlay();
  const send = () => {
    win.showInactive();
    win.webContents.send("chip", change);
  };
  if (win.webContents.isLoading()) win.webContents.once("did-finish-load", send);
  else send();
}

// ---------- settings window (opened from the tray) ----------
function openSettings() {
  if (settingsWin) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 420,
    height: 640,
    title: "Inline Autocorrect",
    resizable: true,
    minimizable: false,
    fullscreenable: false,
    show: false,
    webPreferences: WEB_PREFS,
  });
  settingsWin.loadURL(`${UI_ORIGIN}/settings.html`);
  settingsWin.once("ready-to-show", () => settingsWin.show());
  settingsWin.on("closed", () => (settingsWin = null));
}
function pushState() {
  const state = { settings, changes: changes.slice(0, 80), stats, hook: hookStarted, typer: engine ? { mode: engine.apply.mode?.(), last: engine.apply.last } : null, permissions: permissionState(), platform: process.platform, api: API_BASE, version: app.getVersion(), library: engine ? { count: engine.library.count, version: engine.library.version } : null, keyEvents, lastKeyAt, layout, startedAt };
  if (settingsWin) settingsWin.webContents.send("state", state);
  return state;
}

// ---------- permissions (macOS) ----------
function permissionState() {
  if (process.platform !== "darwin") return { accessibility: true, inputMonitoring: true };
  return { accessibility: systemPreferences.isTrustedAccessibilityClient(false), inputMonitoring: hookStarted };
}

// ---------- keyboard hook ----------
function startHook() {
  if (hookStarted) return true;
  try {
    ({ uIOhook: uiohook, UiohookKey } = require("uiohook-napi"));
  } catch (e) {
    dialog.showErrorBox("Keyboard hook unavailable", `The keyboard listener could not be loaded on this platform.\n${e.message}`);
    return false;
  }
  const handler = makeKeyHandler({
    engine,
    UiohookKey,
    getLayout: () => layout,
    onEvent: () => {
      keyEvents++;
      lastKeyAt = Date.now();
    },
  });
  uiohook.on("keydown", handler);
  uiohook.on("mousedown", () => engine.reset("click"));
  try {
    uiohook.start();
    hookStarted = true;
    const refreshLayout = () => detectLayout().then((l) => (layout = l));
    refreshLayout();
    setInterval(refreshLayout, 15_000);
  } catch (e) {
    dialog.showErrorBox("Keyboard hook failed", e.message);
    return false;
  }
  return true;
}

// ---------- tray ----------
function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: settings.enabled ? "Autocorrect is ON" : "Autocorrect is OFF", enabled: false },
    { label: settings.enabled ? "Turn off" : "Turn on", click: () => setSetting("enabled", !settings.enabled) },
    { type: "separator" },
    { label: "Settings and changes…", click: openSettings },
    { label: "Open web preview", click: () => shell.openExternal(API_BASE) },
    { label: `Check for updates… (v${app.getVersion()})`, click: () => checkForUpdate(API_BASE, { silent: false }) },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
}
function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(buildTrayMenu());
  tray.setToolTip(`Inline Autocorrect · ${settings.enabled ? "on" : "off"}`);
}
function setSetting(key, value) {
  if (!SETTING_RULES[key] || !SETTING_RULES[key](value)) return;
  settings[key] = value;
  saveSettings();
  refreshTray();
  if (key === "overlayCorner") positionOverlay();
  pushState();
}

// ---------- app ----------
// Renderer hardening: our pages never navigate, never open windows, never get web-platform permissions.
app.on("web-contents-created", (_e, contents) => {
  if (process.env.ICA_DEBUG) contents.on("console-message", (ev) => console.log("[renderer]", ev.level, ev.message, ev.sourceId ?? "", ev.lineNumber ?? ""));
  if (process.env.ICA_DEBUG) contents.on("preload-error", (_ev, p, err) => console.log("[preload-error]", p, err.message));
  contents.on("will-navigate", (e, url) => {
    if (!url.startsWith(`${UI_ORIGIN}/`)) e.preventDefault();
  });
  contents.on("will-attach-webview", (e) => e.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  contents.session.setPermissionCheckHandler(() => false);
});
app.whenReady().then(async () => {
  registerUiScheme();
  loadSettings();
  if (process.platform === "darwin") app.dock?.hide();
  const trayIcon = process.platform === "darwin" ? nativeImage.createFromPath(path.join(__dirname, "assets", "trayTemplate.png")) : nativeImage.createFromPath(path.join(__dirname, "assets", "tray-win.png"));
  if (process.platform === "darwin") trayIcon.setTemplateImage(true);
  tray = new Tray(trayIcon);
  refreshTray();
  tray.on("click", () => {
    if (process.platform === "win32") openSettings();
    else tray.popUpContextMenu();
  });
  tray.on("double-click", openSettings);

  const typer = makeTyper({ logFile: path.join(app.getPath("userData"), "typer.log") });
  engine = new Engine({
    apiBase: API_BASE,
    settings: () => ({ enabled: settings.enabled, aggressiveness: settings.aggressiveness, lang: settings.lang, tone: settings.tone }),
    apply: typer,
    secureField: typer.secureField,
    onChange: (c) => {
      const entry = { id: `${Date.now().toString(36)}${changes.length}`, ...c, at: Date.now(), reverted: false };
      changes.unshift(entry);
      if (changes.length > 200) changes.length = 200;
      stats.applied++;
      showChip(entry);
      pushState();
    },
    log: (m) => {
      if (process.env.ICA_DEBUG) console.log(m);
    },
  });

  onLibraryRelease(() => engine.refreshLibrary());
  onBeforeExit(() => {
    try {
      uiohook?.stop();
    } catch {}
    try {
      typer.dispose?.();
    } catch {}
  });

  if (process.platform === "darwin") {
    const trusted = systemPreferences.isTrustedAccessibilityClient(true); // prompts once
    if (!trusted) openSettings();
  }
  const ok = startHook();
  if (!ok || (process.platform === "darwin" && !systemPreferences.isTrustedAccessibilityClient(false))) openSettings();
  else if (settings.firstRun !== false) {
    openSettings();
    setSetting("firstRun", false);
  }
  if (process.env.ICA_FORCE_SETTINGS) {
    openSettings();
    // Debug aid: print what the settings page actually rendered, so a blank window is caught by tests.
    settingsWin.webContents.once("did-finish-load", () => setTimeout(() => settingsWin.webContents.executeJavaScript("document.body.innerText.slice(0, 400)").then((t) => console.log("[settings text]", JSON.stringify(t))).catch((e) => console.log("[settings text] error", e.message)), 1500));
  }
  // Running from Downloads (macOS App Translocation) or an opened zip: offer to move to Applications so updates work.
  setTimeout(() => offerMoveToApplications().catch(() => {}), 2500);
});
app.on("window-all-closed", (e) => e.preventDefault());
app.whenReady().then(() => {
  setTimeout(() => checkForUpdate(API_BASE), 15_000);
  setInterval(() => checkForUpdate(API_BASE), 6 * 60 * 60 * 1000);
});
app.on("before-quit", () => {
  try {
    uiohook?.stop();
  } catch {}
  try {
    engine?.apply?.dispose?.();
  } catch {}
});

// ---------- IPC ----------
ipcMain.handle("state", (e) => {
  const ok = trustedSender(e);
  if (process.env.ICA_DEBUG) console.log("ipc state", ok ? "trusted" : "REJECTED", e.senderFrame?.url);
  return ok ? pushState() : null;
});
ipcMain.handle("set", (e, key, value) => {
  if (!trustedSender(e)) return null;
  setSetting(String(key), value);
  return settings;
});
ipcMain.handle("revert", async (e, id) => {
  if (!trustedSender(e)) return false;
  const c = changes.find((x) => x.id === id);
  if (!c || c.reverted) return false;
  const idx = engine.changes.findIndex((x) => x.old === c.old && x.to === c.to && engine.buf.slice(x.start, x.end) === x.to);
  if (idx < 0) return false;
  const ch = engine.changes[idx];
  const tail = engine.buf.slice(ch.end);
  const ok = await engine.rewrite(ch.start, ch.to, ch.old, tail, "revert");
  if (ok) {
    engine.never.add(c.old.toLowerCase());
    c.reverted = true;
    stats.reverted++;
    pushState();
  }
  return ok;
});
ipcMain.handle("openPermissions", (e, which) => {
  if (!trustedSender(e) || process.platform !== "darwin") return;
  const pane = which === "input" ? "Privacy_ListenEvent" : "Privacy_Accessibility";
  shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`);
});
ipcMain.handle("retryHook", (e) => {
  if (!trustedSender(e)) return null;
  // A listener created while Input Monitoring was denied never delivers events, so stop it and start afresh.
  try {
    uiohook?.removeAllListeners?.();
    uiohook?.stop();
  } catch {}
  hookStarted = false;
  keyEvents = 0;
  startedAt = Date.now();
  startHook();
  return pushState();
});
ipcMain.handle("openWeb", (e) => trustedSender(e) && shell.openExternal(API_BASE));
ipcMain.handle("feedback", async (e, text, contact) => {
  if (!trustedSender(e) || typeof text !== "string") return false;
  try {
    const r = await fetch(`${API_BASE}/api/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: String(text).slice(0, 2000), contact: String(contact ?? "").slice(0, 120), platform: `${process.platform}-${process.arch}`, version: app.getVersion() }) });
    return r.ok;
  } catch {
    return false;
  }
});
