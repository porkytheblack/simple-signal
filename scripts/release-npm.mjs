#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");

// Dependencies are released before the packages that reference them. Keep
// this explicit: release order is operational policy, not an incidental
// filesystem or workspace traversal order.
const releaseOrder = [
  "station-signal",
  "station-expressions",
  "station-env",
  "station-network",
  "station-schedules",
  "station-broadcast",
  "station-beacon",
  "station-browser",
  "station-adapter-sqlite",
  "station-adapter-postgres",
  "station-adapter-mysql",
  "station-adapter-redis",
  "station-kit",
  "station-tauri",
];

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const resume = args.has("--resume");
const allowDirty = args.has("--allow-dirty");
const skipChecks = args.has("--skip-checks");
const help = args.has("--help") || args.has("-h");
const knownFlags = new Set(["--", "--dry-run", "--resume", "--allow-dirty", "--skip-checks", "--help", "-h", "--tag"]);

function valueAfter(flag, fallback) {
  const values = process.argv.slice(2);
  const index = values.indexOf(flag);
  if (index === -1) return fallback;
  const value = values[index + 1];
  if (!value || value.startsWith("--")) fail(`${flag} requires a value.`);
  return value;
}

const tag = valueAfter("--tag", "latest");

for (const [index, arg] of process.argv.slice(2).entries()) {
  if (index > 0 && process.argv.slice(2)[index - 1] === "--tag") continue;
  if (!knownFlags.has(arg)) fail(`Unknown option: ${arg}`);
}

if (help) {
  console.log(`Publish every Station package to npm in dependency order.

Usage:
  pnpm release
  pnpm release --dry-run
  pnpm release --resume
  pnpm release --tag next

The release:npm and release:npm:dry-run scripts remain aliases.

Options:
  --dry-run      Build and run npm publish dry-runs without uploading
  --resume       Skip exact package versions already present on npm
  --tag <tag>    Publish under an npm dist-tag (default: latest)
  --allow-dirty  Permit a dirty worktree (intended for local dry-run QA)
  --skip-checks  Skip typecheck/tests for local dry-run packaging QA only
`);
  process.exit(0);
}

function fail(message) {
  throw new Error(message);
}

function run(command, commandArgs, options = {}) {
  const printable = [command, ...commandArgs].join(" ");
  console.log(`\n[release] $ ${printable}`);
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    env: process.env,
  });
  if (result.error) fail(`${printable} could not start: ${result.error.message}`);
  if (!options.allowFailure && result.status !== 0) {
    if (options.capture) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    fail(`${printable} failed with exit code ${result.status}.`);
  }
  return result;
}

function readPackage(name) {
  const packageDir = resolve(root, "packages", name);
  const manifestPath = resolve(packageDir, "package.json");
  if (!existsSync(manifestPath)) fail(`Missing manifest for ${name}.`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.name !== name) fail(`${manifestPath} declares ${manifest.name}, expected ${name}.`);
  if (manifest.private) fail(`${name} is private and cannot be released.`);
  if (manifest.license !== "MIT") fail(`${name} must declare its MIT license before release.`);
  if (!existsSync(resolve(packageDir, "LICENSE"))) fail(`${name} is missing LICENSE.`);
  if (!existsSync(resolve(packageDir, "README.md"))) fail(`${name} is missing README.md.`);
  return { name, version: manifest.version, manifest };
}

function publishedVersion(name, version) {
  const result = run("npm", ["view", `${name}@${version}`, "version", "--json"], {
    capture: true,
    allowFailure: true,
  });
  if (result.status === 0) return true;
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (/E404|404 Not Found|is not in this registry/i.test(output)) return false;
  process.stderr.write(output);
  fail(`Could not determine whether ${name}@${version} is already published.`);
}

function validateArchive(item, archive) {
  const listing = run("tar", ["-tzf", archive], { capture: true });
  const files = new Set(listing.stdout.trim().split("\n"));
  const packed = JSON.parse(run("tar", ["-xOf", archive, "package/package.json"], { capture: true }).stdout);
  if (packed.name !== item.name || packed.version !== item.version) fail(`Wrong manifest in ${archive}.`);
  if (JSON.stringify(packed).includes("workspace:")) fail(`${item.name} still has workspace protocols in its packed manifest.`);
  const paths = ["./LICENSE", "./README.md", packed.main, packed.types];
  function collect(value) {
    if (typeof value === "string" && value.startsWith("./")) paths.push(value);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  }
  collect(packed.exports);
  collect(packed.imports);
  collect(packed.bin);
  for (const path of paths.filter(Boolean)) {
    if (path.includes("*")) continue;
    if (!files.has(`package/${path.replace(/^\.\//, "")}`)) fail(`${item.name} tarball is missing ${path}.`);
  }
}

function main() {
  if ((allowDirty || skipChecks) && !dryRun) {
    fail("--allow-dirty and --skip-checks are only supported with --dry-run.");
  }
  if (!allowDirty) {
    const status = run("git", ["status", "--porcelain", "--untracked-files=normal"], { capture: true });
    if (status.stdout.trim()) fail("The worktree is dirty. Commit the release first, or use --allow-dirty for a local dry run.");
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(tag)) fail(`Invalid npm dist-tag: ${tag}`);

  // A new public package must not silently disappear from a release.
  for (const entry of readdirSync(resolve(root, "packages"), { withFileTypes: true })) {
    const path = resolve(root, "packages", entry.name, "package.json");
    if (!entry.isDirectory() || !existsSync(path)) continue;
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    if (!manifest.private && !releaseOrder.includes(manifest.name)) fail(`Public package ${manifest.name} is missing from releaseOrder.`);
  }
  const packages = releaseOrder.map(readPackage);
  const versions = new Set(packages.map((item) => item.version));
  if (versions.size !== 1) fail(`Every public Station package must share one version. Found: ${[...versions].join(", ")}`);
  const version = packages[0].version;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) fail(`Invalid release version: ${version}`);
  for (const [index, item] of packages.entries()) {
    const dependencies = { ...item.manifest.dependencies, ...item.manifest.peerDependencies };
    for (const name of Object.keys(dependencies)) {
      const position = releaseOrder.indexOf(name);
      if (position >= index) fail(`${name} must be released before ${item.name}.`);
    }
  }
  console.log(`[release] Station ${version} -> npm tag "${tag}"${dryRun ? " (dry run)" : ""}`);
  const pending = packages.filter((item) => {
    if (!publishedVersion(item.name, item.version)) return true;
    if (!resume) fail(`${item.name}@${item.version} is already on npm. Bump every package version, or use --resume after a partial release.`);
    console.log(`[release] resume: skipping ${item.name}@${item.version}`);
    return false;
  });
  if (!pending.length) { console.log("[release] All versions are already published; nothing to do."); return; }
  if (!dryRun) run("npm", ["whoami"]);

  // Finish every build/check/archive before the first irreversible upload.
  // Build all dependencies even on --resume so clean checkouts need no dist files.
  run("pnpm", ["build"]);
  if (!skipChecks) {
    run("pnpm", ["typecheck"]);
    run("pnpm", ["test:browser:install"]);
    run("pnpm", ["test"]);
  }
  const staging = mkdtempSync(resolve(tmpdir(), "station-release-"));
  try {
    const archives = pending.map((item) => {
      run("pnpm", ["--filter", item.name, "pack", "--pack-destination", staging]);
      const path = resolve(staging, `${item.name}-${item.version}.tgz`);
      if (!existsSync(path)) fail(`Missing packed archive: ${path}`);
      validateArchive(item, path);
      return path;
    });
    for (const archive of archives) {
      run("npm", ["publish", archive, "--access", "public", "--tag", tag, "--dry-run"]);
    }
    if (!dryRun) {
      for (const archive of archives) run("npm", ["publish", archive, "--access", "public", "--tag", tag]);
    }
  } finally { rmSync(staging, { recursive: true, force: true }); }
  console.log(`\n[release] ${dryRun ? "Dry run complete" : "Published"}: Station ${version} (${pending.length} packages)`);
}

try { main(); }
catch (error) { console.error(`\n[release] ${error.message}`); process.exitCode = 1; }
