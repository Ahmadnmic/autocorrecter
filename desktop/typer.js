// Applies a correction to the focused application. A correction is "replace `old`, which sits `tail` characters
// before the caret, with `to`"; nothing after the word is touched.
//
//   macOS:   the Accessibility API replaces the exact range in place (native fields and Chromium/Electron apps:
//            Chrome, Slack, VS Code, Claude). Instant and atomic, like the web app. If a field does not support
//            it, the fallback moves the caret back over the tail with arrow keys, selects the word with
//            Shift+Left, types the replacement over the selection and moves the caret back. Never Backspace + retype.
//   Windows: UI Automation's text pattern selects exactly the old word (no caret keystrokes) and the replacement is
//            typed over the selection; fields without a text pattern fall back to arrow-key selection. The same
//            helper answers whether the focused control is a password field.
"use strict";
const { spawn, execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

/** Corrections are single words or short phrases; anything else (line breaks, control characters) is never typed. */
const clean = (s) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, "");

function helperPath() {
  const packaged = path.join(process.resourcesPath || "", "app.asar.unpacked", "native", "axreplace");
  if (process.resourcesPath && fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, "native", "axreplace");
}

function macTyper() {
  const esc = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const helper = helperPath();
  let helperOk = fs.existsSync(helper);
  const osa = (lines) =>
    new Promise((resolve, reject) => {
      const args = [];
      for (const l of ['tell application "System Events"', ...lines, "end tell"]) args.push("-e", l);
      execFile("osascript", args, (err, _out, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve()));
    });
  /** Accessibility replace. Resolves "ok", "unsupported" (fall back to keys) or "desync" (text is not where we think). */
  const ax = (tail, old, to) =>
    new Promise((resolve) => {
      if (!helperOk) return resolve("unsupported");
      execFile(helper, [String(tail), old, to], { timeout: 700 }, (err, stdout) => {
        const code = err ? err.code : 0;
        if (code === 0) return resolve("ok");
        if (code === 3) return resolve("desync");
        if (typeof code !== "number") helperOk = false; // could not run at all
        resolve("unsupported");
      });
    });
  const type = async ({ tail, old, to }) => {
    const text = clean(to);
    const r = await ax(tail, old, text);
    if (r === "ok") return true;
    if (r === "desync") return false;
    // Fallback: caret left over the tail, select the word backwards, type over the selection, caret back.
    const lines = [];
    if (tail > 0) lines.push(`repeat ${Math.min(tail, 200)} times`, "key code 123", "end repeat");
    lines.push(`repeat ${Math.min(old.length, 100)} times`, "key code 123 using shift down", "end repeat");
    if (text) lines.push(`keystroke "${esc(text)}"`);
    else lines.push("key code 51");
    if (tail > 0) lines.push(`repeat ${Math.min(tail, 200)} times`, "key code 124", "end repeat");
    await osa(lines);
    return true;
  };
  // macOS blocks every event tap while Secure Input is on (password fields in Safari, Chrome, login windows),
  // so the hook never sees those keys; nothing extra to probe here.
  type.secureField = async () => false;
  type.mode = () => (helperOk ? "accessibility" : "keys");
  type.atomic = helperOk;
  return type;
}

function winTyper() {
  let ps = null;
  let pending = [];
  let uiaWorks = null; // null = unknown, true after the first in-place replacement, false when the field has no text pattern
  const PS_PRELUDE = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName UIAutomationClient",
    "Add-Type -AssemblyName UIAutomationTypes",
    "function IsPw { try { $e=[System.Windows.Automation.AutomationElement]::FocusedElement; if ($e -and $e.Current.IsPassword) { 'PW:1' } else { 'PW:0' } } catch { 'PW:0' } }",
    // In-place replacement through the UI Automation text pattern: select exactly the old word (no caret keystrokes),
    // type the replacement over the selection, put the caret back. Answers REP:ok, REP:desync or REP:unsupported.
    "function Rep($tail, $old, $new) {",
    "  try {",
    "    $e = [System.Windows.Automation.AutomationElement]::FocusedElement",
    "    if (-not $e) { return 'REP:unsupported' }",
    "    $tp = $null",
    "    try { $tp = $e.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern) } catch { return 'REP:unsupported' }",
    "    if (-not $tp) { return 'REP:unsupported' }",
    "    $sel = $tp.GetSelection()",
    "    if (-not $sel -or $sel.Count -lt 1) { return 'REP:unsupported' }",
    "    $caret = $sel[0]",
    "    if ($caret.GetText(-1).Length -gt 0) { return 'REP:desync' }",
    "    $r = $caret.Clone()",
    "    [void]$r.MoveEndpointByUnit([System.Windows.Automation.Text.TextPatternRangeEndpoint]::Start, [System.Windows.Automation.Text.TextUnit]::Character, -($tail + $old.Length))",
    "    [void]$r.MoveEndpointByUnit([System.Windows.Automation.Text.TextPatternRangeEndpoint]::End, [System.Windows.Automation.Text.TextUnit]::Character, -$tail)",
    "    $got = $r.GetText(-1)",
    "    if ($got -ne $old) { return 'REP:desync' }",
    "    $r.Select()",
    "    if ($new.Length -gt 0) { [System.Windows.Forms.SendKeys]::SendWait($new) } else { [System.Windows.Forms.SendKeys]::SendWait('{DEL}') }",
    "    if ($tail -gt 0) { [System.Windows.Forms.SendKeys]::SendWait('{RIGHT ' + $tail + '}') }",
    "    return 'REP:ok'",
    "  } catch { return 'REP:unsupported' }",
    "}",
  ].join("\n");
  const start = () => {
    ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "-"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    ps.stdin.write(PS_PRELUDE + "\n");
    let buf = "";
    ps.stdout.on("data", (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        const m = /^(PW|REP):(\S+)$/.exec(line);
        if (m) pending.shift()?.(m[2]);
      }
    });
    ps.on("exit", () => {
      ps = null;
      for (const p of pending.splice(0)) p("unsupported");
    });
  };
  /** Send one command line and wait for its one-line answer. */
  const ask = (cmd, timeoutMs) =>
    new Promise((resolve) => {
      if (!ps) start();
      const t = setTimeout(() => {
        const i = pending.indexOf(done);
        if (i >= 0) pending.splice(i, 1);
        resolve("timeout");
      }, timeoutMs);
      const done = (v) => {
        clearTimeout(t);
        resolve(v);
      };
      pending.push(done);
      ps.stdin.write(cmd + "\n");
    });
  const escKeys = (s) => s.replace(/[+^%~(){}[\]]/g, (c) => `{${c}}`);
  const pq = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const type = async ({ tail, old, to }) => {
    const text = clean(to);
    if (uiaWorks !== false) {
      const r = await ask(`Rep ${Math.max(0, tail | 0)} ${pq(old)} ${pq(escKeys(text))}`, 1500);
      if (r === "ok") {
        uiaWorks = true;
        return true;
      }
      if (r === "desync") return false;
      if (uiaWorks === null) uiaWorks = false;
    }
    // Fallback (fields without a text pattern): caret left over the tail, select the word backwards with Shift+Left,
    // type over the selection, caret back. Never Backspace + retype.
    let keys = "";
    if (tail > 0) keys += `{LEFT ${Math.min(tail, 200)}}`;
    keys += `+({LEFT ${Math.min(old.length, 100)}})`;
    keys += text ? escKeys(text) : "{DEL}";
    if (tail > 0) keys += `{RIGHT ${Math.min(tail, 200)}}`;
    if (!ps) start();
    ps.stdin.write(`[System.Windows.Forms.SendKeys]::SendWait(${pq(keys)})\n`);
    await new Promise((r) => setTimeout(r, 15 + 2 * (2 * tail + old.length + text.length)));
    return true;
  };
  /** Windows delivers password-field keystrokes to low-level hooks, so ask UI Automation about the focused control. */
  type.secureField = async () => (await ask("IsPw", 400)) === "1";
  type.mode = () => (uiaWorks === false ? "keys" : "uiautomation");
  Object.defineProperty(type, "atomic", { get: () => uiaWorks !== false });
  /** Close the helper PowerShell (it would otherwise outlive the app and can hold the app folder open). */
  type.dispose = () => {
    try {
      ps?.stdin.end();
      ps?.kill();
    } catch {}
    ps = null;
  };
  return type;
}

function makeTyper() {
  return process.platform === "win32" ? winTyper() : macTyper();
}

module.exports = { makeTyper, clean, helperPath };
