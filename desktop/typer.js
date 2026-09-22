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

function macTyper(opts = {}) {
  const esc = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const helper = helperPath();
  let helperOk = fs.existsSync(helper);
  // A helper unpacked from a downloaded zip carries the quarantine flag, and Gatekeeper then refuses to run it.
  try {
    if (helperOk) execFile("xattr", ["-d", "com.apple.quarantine", helper], () => {});
  } catch {}
  const last = { method: "", result: "", ms: 0, at: 0 };
  const log = (m) => {
    if (!opts.logFile) return;
    try {
      if (fs.existsSync(opts.logFile) && fs.statSync(opts.logFile).size > 1_000_000) fs.truncateSync(opts.logFile, 0);
      fs.appendFileSync(opts.logFile, `[${new Date().toISOString()}] ${m}\n`);
    } catch {}
  };
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
        const why = String(stdout || "").trim();
        if (code === 0) return resolve("ok");
        if (code === 3) return resolve(`desync:${why}`);
        if (typeof code !== "number") helperOk = false; // could not run at all
        resolve(`unsupported:${why || code}`);
      });
    });
  /** Does the focused field accept in-place replacement right now? Cheap (a few ms); asked before every edit. */
  type.probe = () =>
    new Promise((resolve) => {
      if (!helperOk) return resolve(false);
      execFile(helper, ["probe"], { timeout: 500 }, (err, stdout) => {
        const code = err ? err.code : 0;
        if (typeof code !== "number") {
          helperOk = false;
          log(`helper cannot run: ${err?.message}`);
        } else if (code !== 0) log(`probe: ${String(stdout).trim() || code}`);
        resolve(code === 0);
      });
    });
  const type = async ({ tail, old, to, atomic = true }) => {
    const text = clean(to);
    const t0 = Date.now();
    const finish = (method, result, ok) => {
      Object.assign(last, { method, result, ms: Date.now() - t0, at: Date.now() });
      log(`${method}: tail=${tail} "${old}" -> "${text}" => ${result} (${last.ms} ms)`);
      return ok;
    };
    const r = atomic ? await ax(tail, old, text) : "unsupported:probe";
    if (r === "ok") return finish("accessibility", "ok", true);
    if (r.startsWith("desync")) return finish("accessibility", r, false);
    if (atomic) log(`accessibility unavailable (${r}); using keys`);
    // Fallback: caret left over the tail, select the word backwards, type over the selection, caret back.
    const lines = [];
    if (tail > 0) lines.push(`repeat ${Math.min(tail, 200)} times`, "key code 123", "end repeat");
    lines.push(`repeat ${Math.min(old.length, 100)} times`, "key code 123 using shift down", "end repeat");
    if (text) lines.push(`keystroke "${esc(text)}"`);
    else lines.push("key code 51");
    if (tail > 0) lines.push(`repeat ${Math.min(tail, 200)} times`, "key code 124", "end repeat");
    try {
      await osa(lines);
      return finish("keys", "ok", true);
    } catch (e) {
      return finish("keys", `failed:${e.message}`, false);
    }
  };
  type.last = last;
  // macOS blocks every event tap while Secure Input is on (password fields in Safari, Chrome, login windows),
  // so the hook never sees those keys; nothing extra to probe here.
  type.secureField = async () => false;
  type.mode = () => (helperOk ? "accessibility" : "keys");
  type.atomic = helperOk;
  return type;
}

function winTyper(opts = {}) {
  const logFile = opts.logFile || null;
  const log = (m) => {
    if (!logFile) return;
    try {
      if (fs.existsSync(logFile) && fs.statSync(logFile).size > 1_000_000) fs.truncateSync(logFile, 0);
      fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${m}\n`);
    } catch {}
  };
  const pq = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const escKeys = (s) => s.replace(/[+^%~(){}[\]]/g, (c) => `{${c}}`);

  /** A persistent PowerShell that answers one line per command. Killed and restarted when a command hangs. */
  function makeShell(name, prelude) {
    let ps = null;
    let pending = [];
    const start = () => {
      ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "-"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      ps.stdin.write(prelude + "\n");
      let buf = "";
      ps.stdout.on("data", (d) => {
        buf += d.toString();
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          const m = /^R:(.*)$/.exec(line);
          if (m) pending.shift()?.(m[1]);
        }
      });
      ps.stderr.on("data", (d) => log(`${name} stderr: ${String(d).trim().slice(0, 300)}`));
      ps.on("exit", (code) => {
        log(`${name} exited (${code})`);
        ps = null;
        for (const p of pending.splice(0)) p("gone");
      });
    };
    const kill = () => {
      try {
        ps?.kill();
      } catch {}
      ps = null;
      for (const p of pending.splice(0)) p("killed");
    };
    const ask = (cmd, timeoutMs) =>
      new Promise((resolve) => {
        if (!ps) start();
        const t = setTimeout(() => {
          const i = pending.indexOf(done);
          if (i >= 0) pending.splice(i, 1);
          log(`${name}: timeout after ${timeoutMs} ms, restarting shell`);
          kill();
          resolve("timeout");
        }, timeoutMs);
        const done = (v) => {
          clearTimeout(t);
          resolve(v);
        };
        pending.push(done);
        ps.stdin.write(cmd + "\n");
      });
    return { ask, kill, start };
  }

  // Shell 1: UI Automation (password check, in-place replacement). Every answer is prefixed "R:".
  const uia = makeShell("uia", [
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName UIAutomationClient",
    "Add-Type -AssemblyName UIAutomationTypes",
    "function IsPw { try { $e=[System.Windows.Automation.AutomationElement]::FocusedElement; if ($e -and $e.Current.IsPassword) { 'R:pw1' } else { 'R:pw0' } } catch { 'R:pw0' } }",
    // Select exactly the old word through the text pattern (no caret keystrokes), type the replacement over the
    // selection, read it back to confirm, put the caret back. Answers R:ok, R:desync, R:failed or R:unsupported:<why>.
    "function Rep($tail, $old, $new, $raw) {",
    "  try {",
    "    $e = [System.Windows.Automation.AutomationElement]::FocusedElement",
    "    if (-not $e) { return 'R:unsupported:nofocus' }",
    "    $tp = $null",
    "    try { $tp = $e.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern) } catch { return 'R:unsupported:nopattern' }",
    "    if (-not $tp) { return 'R:unsupported:nopattern' }",
    "    $sel = $tp.GetSelection()",
    "    if (-not $sel -or $sel.Count -lt 1) { return 'R:unsupported:nosel' }",
    "    $caret = $sel[0]",
    "    if ($caret.GetText(-1).Length -gt 0) { return 'R:desync' }",
    "    $r = $caret.Clone()",
    "    [void]$r.MoveEndpointByUnit([System.Windows.Automation.Text.TextPatternRangeEndpoint]::Start, [System.Windows.Automation.Text.TextUnit]::Character, -($tail + $old.Length))",
    "    [void]$r.MoveEndpointByUnit([System.Windows.Automation.Text.TextPatternRangeEndpoint]::End, [System.Windows.Automation.Text.TextUnit]::Character, -$tail)",
    "    $got = $r.GetText(-1)",
    "    if ($got -cne $old) { return ('R:desync:' + $got) }",
    "    $r.Select()",
    "    Start-Sleep -Milliseconds 15",
    "    if ($new.Length -gt 0) { [System.Windows.Forms.SendKeys]::SendWait($new) } else { [System.Windows.Forms.SendKeys]::SendWait('{DEL}') }",
    "    Start-Sleep -Milliseconds 40",
    "    $ok = $true",
    "    try {",
    "      $after = $tp.GetSelection()[0].Clone()",
    "      [void]$after.MoveEndpointByUnit([System.Windows.Automation.Text.TextPatternRangeEndpoint]::Start, [System.Windows.Automation.Text.TextUnit]::Character, -$raw.Length)",
    "      $back = $after.GetText(-1)",
    "      if ($back.Length -gt 0 -and $back -cne $raw) { $ok = $false }",
    "    } catch {}",
    "    if (-not $ok) { return 'R:failed:readback' }",
    "    if ($tail -gt 0) { [System.Windows.Forms.SendKeys]::SendWait('{RIGHT ' + $tail + '}') }",
    "    return 'R:ok'",
    "  } catch { return ('R:unsupported:' + $_.Exception.Message) }",
    "}",
  ].join("\n"));
  // Shell 2: plain keystrokes for fields without a text pattern. Kept separate so a hung UI Automation call can
  // never block it.
  const keys = makeShell("keys", ["Add-Type -AssemblyName System.Windows.Forms", "function K($k) { try { [System.Windows.Forms.SendKeys]::SendWait($k); 'R:ok' } catch { 'R:failed' } }"].join("\n"));

  let uiaState = { works: null, failures: 0, retryAt: 0 }; // null = unknown
  const last = { method: "", result: "", ms: 0, at: 0 };

  const type = async ({ tail, old, to }) => {
    const text = clean(to);
    const t0 = Date.now();
    const finish = (method, result, ok) => {
      Object.assign(last, { method, result, ms: Date.now() - t0, at: Date.now() });
      log(`${method}: tail=${tail} "${old}" -> "${text}" => ${result} (${last.ms} ms)`);
      return ok;
    };
    const tryUia = uiaState.works !== false || Date.now() > uiaState.retryAt;
    if (tryUia) {
      const r = await uia.ask(`Rep ${Math.max(0, tail | 0)} ${pq(old)} ${pq(escKeys(text))} ${pq(text)}`, 2500);
      if (r === "ok") {
        uiaState = { works: true, failures: 0, retryAt: 0 };
        return finish("uiautomation", "ok", true);
      }
      if (r.startsWith("desync")) return finish("uiautomation", r, false);
      if (r.startsWith("failed")) return finish("uiautomation", r, false);
      // unsupported / timeout / gone: use keystrokes now, retry UI Automation later
      uiaState.failures++;
      if (uiaState.failures >= 2) uiaState = { works: false, failures: 0, retryAt: Date.now() + 60_000 };
      log(`uiautomation unavailable (${r}); using keys`);
    }
    let k = "";
    if (tail > 0) k += `{LEFT ${Math.min(tail, 200)}}`;
    k += `+({LEFT ${Math.min(old.length, 100)}})`;
    k += text ? escKeys(text) : "{DEL}";
    if (tail > 0) k += `{RIGHT ${Math.min(tail, 200)}}`;
    const r = await keys.ask(`K ${pq(k)}`, 4000);
    return finish("keys", r, r === "ok");
  };
  /** Windows delivers password-field keystrokes to low-level hooks, so ask UI Automation about the focused control. */
  type.secureField = async () => (await uia.ask("IsPw", 700)) === "pw1";
  type.mode = () => (uiaState.works === false ? "keys" : uiaState.works ? "uiautomation" : "uiautomation?");
  type.last = last;
  Object.defineProperty(type, "atomic", { get: () => uiaState.works !== false });
  /** Close the helper shells (they would otherwise outlive the app and can hold the app folder open). */
  type.dispose = () => {
    uia.kill();
    keys.kill();
  };
  return type;
}

function makeTyper(opts = {}) {
  return process.platform === "win32" ? winTyper(opts) : macTyper(opts);
}

module.exports = { makeTyper, clean, helperPath };
