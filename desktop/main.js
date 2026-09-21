"use strict";
const { app, Tray, Menu, BrowserWindow, nativeImage, ipcMain, screen, shell, systemPreferences, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { Engine } = require("./engine.js");
const { makeTyper } = require("./typer.js");
const { checkForUpdate, onLibraryRelease } = require("./updater.js");

const API_BASE = process.env.ICA_API_BASE || "https://inline-autocorrect.vercel.app";
const SETTINGS_FILE = () => path.join(app.getPath("userData"), "settings.json");
const defaults = { enabled: true, aggressiveness: 0.5, lang: "auto", overlay: true, overlayCorner: "bottom-right" };
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

function loadSettings() {
  try {
    settings = { ...defaults, ...JSON.parse(fs.readFileSync(SETTINGS_FILE(), "utf8")) };
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
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true },
  });
  overlayWin.setIgnoreMouseEvents(true);
  overlayWin.setAlwaysOnTop(true, "screen-saver");
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWin.loadFile(path.join(__dirname, "ui", "overlay.html"));
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
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true },
  });
  settingsWin.loadFile(path.join(__dirname, "ui", "settings.html"));
  settingsWin.once("ready-to-show", () => settingsWin.show());
  settingsWin.on("closed", () => (settingsWin = null));
}
function pushState() {
  const state = { settings, changes: changes.slice(0, 80), stats, hook: hookStarted, permissions: permissionState(), platform: process.platform, api: API_BASE, version: app.getVersion(), library: engine ? { count: engine.library.count, version: engine.library.version } : null };
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
  const RESET_KEYS = new Set([UiohookKey.Enter, UiohookKey.Tab, UiohookKey.Escape, UiohookKey.ArrowLeft, UiohookKey.ArrowRight, UiohookKey.ArrowUp, UiohookKey.ArrowDown, UiohookKey.Home, UiohookKey.End, UiohookKey.PageUp, UiohookKey.PageDown, UiohookKey.Delete]);
  uiohook.on("keydown", (e) => {
    if (engine.applying) return; // our own synthetic keystrokes
    const mod = e.ctrlKey || e.metaKey || (e.altKey && process.platform !== "win32");
    if (mod) return engine.reset("modifier");
    if (e.keycode === UiohookKey.Backspace) return engine.backspace();
    if (RESET_KEYS.has(e.keycode)) return engine.reset("navigation");
    if (e.keychar && e.keychar >= 32) engine.char(String.fromCodePoint(e.keychar));
  });
  uiohook.on("mousedown", () => engine.reset("click"));
  try {
    uiohook.start();
    hookStarted = true;
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
  settings[key] = value;
  saveSettings();
  refreshTray();
  if (key === "overlayCorner") positionOverlay();
  pushState();
}

// ---------- app ----------
app.whenReady().then(async () => {
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

  engine = new Engine({
    apiBase: API_BASE,
    settings: () => ({ enabled: settings.enabled, aggressiveness: settings.aggressiveness, lang: settings.lang }),
    apply: makeTyper(),
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
});

// ---------- IPC ----------
ipcMain.handle("state", () => pushState());
ipcMain.handle("set", (_e, key, value) => {
  setSetting(key, value);
  return settings;
});
ipcMain.handle("revert", async (_e, id) => {
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
ipcMain.handle("openPermissions", (_e, which) => {
  if (process.platform !== "darwin") return;
  const pane = which === "input" ? "Privacy_ListenEvent" : "Privacy_Accessibility";
  shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`);
});
ipcMain.handle("retryHook", () => {
  startHook();
  return pushState();
});
ipcMain.handle("openWeb", () => shell.openExternal(API_BASE));
ipcMain.handle("feedback", async (_e, text, contact) => {
  try {
    const r = await fetch(`${API_BASE}/api/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: String(text).slice(0, 2000), contact: String(contact ?? "").slice(0, 120), platform: `${process.platform}-${process.arch}`, version: app.getVersion() }) });
    return r.ok;
  } catch {
    return false;
  }
});
