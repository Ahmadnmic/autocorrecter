// Sends Backspaces and text to the focused application. No native modules: System Events on macOS, a persistent
// PowerShell process with SendKeys on Windows.
"use strict";
const { spawn, execFile } = require("node:child_process");

function macTyper() {
  const esc = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return async (backspaces, textToType) => {
    const lines = ['tell application "System Events"'];
    if (backspaces > 0) lines.push(`repeat ${backspaces} times`, "key code 51", "end repeat");
    if (textToType) lines.push(`keystroke "${esc(textToType)}"`);
    lines.push("end tell");
    await new Promise((resolve, reject) => {
      const args = [];
      for (const l of lines) args.push("-e", l);
      execFile("osascript", args, (err, _out, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve()));
    });
  };
}

function winTyper() {
  let ps = null;
  const start = () => {
    ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "-"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    ps.stdin.write("Add-Type -AssemblyName System.Windows.Forms\n");
    ps.on("exit", () => (ps = null));
  };
  const escKeys = (s) => s.replace(/[+^%~(){}[\]]/g, (c) => `{${c}}`);
  return async (backspaces, textToType) => {
    if (!ps) start();
    let keys = "";
    if (backspaces > 0) keys += `{BS ${backspaces}}`;
    if (textToType) keys += escKeys(textToType);
    if (!keys) return;
    const cmd = `[System.Windows.Forms.SendKeys]::SendWait('${keys.replace(/'/g, "''")}')\n`;
    ps.stdin.write(cmd);
    // SendWait blocks until keys are processed; give it a moment proportional to the length
    await new Promise((r) => setTimeout(r, 15 + 4 * (backspaces + (textToType ? textToType.length : 0))));
  };
}

function makeTyper() {
  return process.platform === "win32" ? winTyper() : macTyper();
}

module.exports = { makeTyper };
