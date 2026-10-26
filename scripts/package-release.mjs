#!/usr/bin/env node
/**
 * Creator release bundler (NOT shipped to npm).
 * Builds `po-pilot-post-stocky-kit-v<version>.zip` for Polar.sh / Gumroad / Lemon Squeezy / GitHub Releases.
 * Guarantees `package-lock.json` & `.dockerignore` are included so `docker compose up -d` works out-of-the-box,
 * while strictly excluding creator keygen/signing scripts (`scripts/`), `.keys/`, `node_modules/`, and `.git/`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const rootDir = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8"));
const version = pkg.version;

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out-dir");
const outDir = resolve(
  rootDir,
  outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1] : "release-artifacts"
);

mkdirSync(outDir, { recursive: true });
const zipName = `po-pilot-post-stocky-kit-v${version}.zip`;
const zipPath = resolve(outDir, zipName);
if (existsSync(zipPath)) {
  rmSync(zipPath, { force: true });
}

const includedPaths = [
  "README.md",
  "LICENSE",
  ".env.example",
  ".dockerignore",
  "Dockerfile",
  "docker-compose.yml",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "mcpize.yaml",
  "smithery.yaml",
  "glama.json",
  "server.json",
  ".well-known/mcp/server-card.json",
  "src",
  "sales-bundle/QUICKSTART-BUYERS.md",
  "sales-bundle/n8n-templates/01-monday-shopify-po-generator.json",
  "sales-bundle/n8n-templates/02-supplier-invoice-3way-match-guard.json",
  "sales-bundle/n8n-templates/03-email-pdf-invoice-auto-3way-match.json"
];

for (const rel of includedPaths) {
  if (!existsSync(resolve(rootDir, rel))) {
    throw new Error(`Missing required release file: ${rel}`);
  }
}

execFileSync(
  "python3",
  [
    "-c",
    `
import os, sys, zipfile

root_dir = sys.argv[1]
zip_path = sys.argv[2]
items = sys.argv[3:]

with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    for rel in items:
        abs_path = os.path.join(root_dir, rel)
        if os.path.isdir(abs_path):
            for dirpath, dirnames, filenames in os.walk(abs_path):
                dirnames.sort()
                for fname in sorted(filenames):
                    full = os.path.join(dirpath, fname)
                    arc = os.path.relpath(full, root_dir).replace(os.sep, "/")
                    zf.write(full, arc)
        else:
            zf.write(abs_path, rel.replace(os.sep, "/"))
`,
    rootDir,
    zipPath,
    ...includedPaths
  ],
  { stdio: "inherit" }
);

console.log(`Built buyer release bundle: ${zipPath}`);
