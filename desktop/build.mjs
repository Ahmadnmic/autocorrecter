// Release build for the desktop apps. Usage: node build.mjs [--upload] [--notes "text"]
//   1. package with @electron/packager (asar, native module unpacked)
//   2. flip Electron fuses: no ELECTRON_RUN_AS_NODE, no NODE_OPTIONS, no --inspect, app only from asar,
//      no extra file:// privileges (the app holds Input Monitoring / Accessibility grants, so the binary
//      must not be usable as a generic Node runtime by another local process)
//   3. ad-hoc codesign on macOS (until a Developer ID certificate is available)
//   4. zip, SHA-256, size
//   5. write ../desktop-release.json and sign it with the Ed25519 release key (~/.config/inline-autocorrect)
//   6. --upload: push the zips to Vercel Blob and write the URLs into the manifest
import { packager } from "@electron/packager";
import { flipFuses, FuseVersion, FuseV1Options, FuseState, getCurrentFuseWire } from "@electron/fuses";
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(here, "package.json"), "utf8"));
const version = pkg.version;
const dist = path.join(here, "dist");
const args = process.argv.slice(2);
const upload = args.includes("--upload");
const skipPackage = args.includes("--skip-package"); // reuse the zips already in dist/
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null; // package one target, no manifest
const notes = args.includes("--notes") ? args[args.indexOf("--notes") + 1] : `Inline Autocorrect ${version}`;
const targets = [
  { platform: "darwin", arch: "arm64", key: "darwin-arm64", file: `inline-autocorrect-${version}-mac-apple-silicon.zip` },
  { platform: "darwin", arch: "x64", key: "darwin-x64", file: `inline-autocorrect-${version}-mac-intel.zip` },
  { platform: "win32", arch: "x64", key: "win32-x64", file: `inline-autocorrect-${version}-windows-x64.zip` },
];
const sh = (cmd, a, opts = {}) => execFileSync(cmd, a, { stdio: ["ignore", "pipe", "inherit"], maxBuffer: 1 << 26, ...opts }).toString();
/** Like sh, but captures stderr too (the Vercel CLI prints its result there). */
const shAll = (cmd, a, opts = {}) => {
  const r = spawnSync(cmd, a, { encoding: "utf8", maxBuffer: 1 << 26, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr}`);
  return `${r.stdout}\n${r.stderr}`;
};

const FUSES = {
  version: FuseVersion.V1,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
};

const manifest = { version, notes, assets: {} };
for (const t of targets) {
  if (only && t.key !== only) continue;
  console.log(`\n== ${t.key}`);
  const zip = path.join(dist, t.file);
  if (skipPackage && fs.existsSync(zip)) {
    const buf = fs.readFileSync(zip);
    manifest.assets[t.key] = { url: "", sha256: crypto.createHash("sha256").update(buf).digest("hex"), size: buf.length };
    console.log("reusing", t.file, buf.length, manifest.assets[t.key].sha256);
    continue;
  }
  const [outDir] = await packager({
    dir: here,
    out: dist,
    overwrite: true,
    platform: t.platform,
    arch: t.arch,
    asar: { unpack: "**/*.node" },
    icon: path.join(here, "assets", "icon"),
    appBundleId: "com.nmic.inline-autocorrect",
    appCopyright: "nmic demo",
    prune: true,
    ignore: [/^\/dist($|\/)/, /^\/build\.mjs$/, /^\/test.*\.js$/, /^\/\.git/],
    extendInfo: { LSUIElement: true, NSHumanReadableCopyright: "nmic demo" },
  });
  const appPath = t.platform === "darwin" ? path.join(outDir, "Inline Autocorrect.app") : path.join(outDir, "Inline Autocorrect.exe");
  const fuses = { ...FUSES };
  // Asar integrity validation needs the hash that packager embeds in Info.plist; only macOS gets it here.
  if (t.platform === "darwin") fuses[FuseV1Options.EnableEmbeddedAsarIntegrityValidation] = true;
  await flipFuses(appPath, fuses);
  const wire = await getCurrentFuseWire(appPath);
  console.log("fuses:", { runAsNode: wire[FuseV1Options.RunAsNode], onlyAsar: wire[FuseV1Options.OnlyLoadAppFromAsar], inspect: wire[FuseV1Options.EnableNodeCliInspectArguments] });
  const on = (k) => wire[k] === FuseState.ENABLE;
  console.log("fuses:", { runAsNode: on(FuseV1Options.RunAsNode), nodeOptions: on(FuseV1Options.EnableNodeOptionsEnvironmentVariable), inspect: on(FuseV1Options.EnableNodeCliInspectArguments), onlyAsar: on(FuseV1Options.OnlyLoadAppFromAsar), asarIntegrity: on(FuseV1Options.EnableEmbeddedAsarIntegrityValidation) });
  if (on(FuseV1Options.RunAsNode) || on(FuseV1Options.EnableNodeCliInspectArguments) || !on(FuseV1Options.OnlyLoadAppFromAsar)) throw new Error("fuses not applied");

  fs.rmSync(zip, { force: true });
  if (t.platform === "darwin") {
    sh("codesign", ["--force", "--deep", "--sign", "-", appPath]);
    sh("codesign", ["--verify", "--deep", "--strict", appPath]);
    sh("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, zip]);
  } else {
    sh("ditto", ["-c", "-k", "--sequesterRsrc", outDir, zip]);
  }
  const buf = fs.readFileSync(zip);
  manifest.assets[t.key] = { url: "", sha256: crypto.createHash("sha256").update(buf).digest("hex"), size: buf.length };
  console.log(t.file, buf.length, manifest.assets[t.key].sha256);
}
if (only) process.exit(0);
manifest.assets.android = "https://github.com/Ahmadnmic/autocorrecter/releases/latest/download/inline-autocorrect.apk";

if (upload) {
  for (const t of targets) {
    // Two stores are connected to the project (public downloads/library, private logs), so the token is explicit.
    const rw = process.env.BLOB_READ_WRITE_TOKEN;
    if (!rw) throw new Error("Set BLOB_READ_WRITE_TOKEN (public store) for --upload");
    const out = shAll("npx", ["vercel", "blob", "put", path.join(dist, t.file), "--pathname", `downloads/${t.file}`, "--access", "public", "--content-type", "application/zip", "--allow-overwrite", "--rw-token", rw, "--scope", "nmic-demo"], { cwd: path.join(here, "..") });
    const url = (out.match(/https:\/\/[^\s"]+\.zip/) || [])[0];
    if (!url) throw new Error(`No URL returned for ${t.file}: ${out}`);
    manifest.assets[t.key].url = url;
    console.log("uploaded", url);
  }
} else {
  const prev = JSON.parse(fs.readFileSync(path.join(here, "..", "desktop-release.json"), "utf8"));
  for (const t of targets) manifest.assets[t.key].url = typeof prev.assets?.[t.key] === "string" ? prev.assets[t.key] : prev.assets?.[t.key]?.url ?? "";
}

// Sign: the manifest bytes as written are what the app verifies, so write them once and sign exactly that.
const text = JSON.stringify(manifest, null, 2) + "\n";
const keyPath = path.join(os.homedir(), ".config", "inline-autocorrect", "release-key.pem");
const privateKey = fs.readFileSync(keyPath, "utf8");
const signature = crypto.sign(null, Buffer.from(text, "utf8"), privateKey).toString("base64");
fs.writeFileSync(path.join(here, "..", "desktop-release.json"), text);
fs.writeFileSync(path.join(here, "..", "lib", "desktop-release.ts"), `// Generated by desktop/build.mjs. The manifest text is signed as-is; do not edit by hand.\nexport const manifest = ${JSON.stringify(text)};\nexport const signature = ${JSON.stringify(signature)};\n`);
console.log("\nmanifest signed:", signature.slice(0, 16) + "…");
