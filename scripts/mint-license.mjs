#!/usr/bin/env node
/**
 * Creator-only offline Ed25519 license key utility (NOT shipped to npm).
 *
 * 1) Generate keypair locally (saved to gitignored `.keys/`):
 *    node scripts/mint-license.mjs --keygen
 *
 * 2) Mint an offline license token for Upwork / Contra / Gumroad / MCPize Server Secret:
 *    node scripts/mint-license.mjs --sign --sub "merchant@store.com" --tier lifetime
 *    node scripts/mint-license.mjs --sign --sub "agency@ops.co" --tier agency --days 365
 */
import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const keysDir = resolve(process.cwd(), ".keys");
const privPath = resolve(keysDir, "po-pilot-ed25519-private.pem");
const pubPath = resolve(keysDir, "po-pilot-ed25519-public.spki.b64");

const args = process.argv.slice(2);

function getArg(flag, fallback = "") {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}

if (args.includes("--keygen")) {
  mkdirSync(keysDir, { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const privPem = privateKey.export({ type: "pkcs8", format: "pem" });
  const pubB64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  writeFileSync(privPath, privPem, { mode: 0o600 });
  writeFileSync(pubPath, `${pubB64}\n`, "utf8");
  console.log("Generated Ed25519 keypair in .keys/ (gitignored).");
  console.log(`PO_PILOT_PUBLIC_KEY_SPKI_B64=${pubB64}`);
  console.log("Paste that public key into DEFAULT_PUBLIC_KEY_SPKI_B64 in src/entitlements.ts before `npm publish` if issuing offline POP1 keys.");
  process.exit(0);
}

if (args.includes("--sign")) {
  if (!existsSync(privPath)) {
    console.error("Missing .keys/po-pilot-ed25519-private.pem — run `node scripts/mint-license.mjs --keygen` first.");
    process.exit(1);
  }
  const sub = getArg("--sub", "customer@store.com");
  const tier = getArg("--tier", "pro");
  const days = Number(getArg("--days", "0"));
  const payload = {
    sub,
    tier,
    ...(days > 0 ? { exp: Math.floor(Date.now() / 1000) + days * 86400 } : {})
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const privKey = createPrivateKey({ key: readFileSync(privPath, "utf8"), format: "pem", type: "pkcs8" });
  const sigB64 = sign(null, Buffer.from(payloadB64, "utf8"), privKey).toString("base64url");
  console.log(`POP1.${payloadB64}.${sigB64}`);
  process.exit(0);
}

console.log("Usage:\n  node scripts/mint-license.mjs --keygen\n  node scripts/mint-license.mjs --sign --sub <email> [--tier pro|agency|lifetime] [--days 365]");
