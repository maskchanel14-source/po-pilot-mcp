#!/usr/bin/env node
/**
 * Creator-only offline Ed25519 license key utility (NOT shipped to npm).
 *
 * 1) Generate keypair locally (saved to gitignored `.keys/`):
 *    node scripts/mint-license.mjs --keygen
 *    (or stateless stdout mode: node scripts/mint-license.mjs --generate-keypair)
 *
 * 2) Mint an offline license token for Upwork / Contra / Gumroad / MCPize Server Secret:
 *    node scripts/mint-license.mjs --sign --sub "merchant@store.com" --tier lifetime
 *    node scripts/mint-license.mjs --sign --sub "agency@ops.co" --tier agency --days 365
 */
import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const VALID_TIERS = new Set(["pro", "agency", "lifetime"]);
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

if (args.includes("--generate-keypair")) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubDerB64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const privDerB64 = privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
  console.log("=== PO PILOT ED25519 LICENSE KEYPAIR ===");
  console.log("\n1. PUBLIC KEY (safe to embed in src/entitlements.ts -> DEFAULT_PUBLIC_KEY_SPKI_B64):");
  console.log(pubDerB64);
  console.log("\n2. PRIVATE SIGNING KEY (KEEP SECRET — store in 1Password / Bitwarden, NEVER commit):");
  console.log(privDerB64);
  process.exit(0);
}

if (args.includes("--sign")) {
  const sub = (getArg("--sub") || getArg("--email") || "customer@store.com").trim();
  const tier = getArg("--tier", "pro").trim().toLowerCase();
  if (!VALID_TIERS.has(tier)) {
    console.error(`Error: Invalid --tier '${tier}'. Must be one of: pro, agency, lifetime.`);
    process.exit(1);
  }

  const rawDays = getArg("--days", tier === "lifetime" ? "0" : "0");
  const days = Number(rawDays);
  if (!Number.isFinite(days) || days < 0) {
    console.error(`Error: Invalid --days '${rawDays}'. Must be a non-negative number (0 = lifetime).`);
    process.exit(1);
  }

  let privateKey;
  const privB64 = process.env.PO_PILOT_SIGNING_PRIVATE_KEY_B64 || getArg("--private-key");
  if (privB64) {
    privateKey = createPrivateKey({
      key: Buffer.from(privB64, "base64"),
      format: "der",
      type: "pkcs8"
    });
  } else if (existsSync(privPath)) {
    privateKey = createPrivateKey({ key: readFileSync(privPath, "utf8"), format: "pem", type: "pkcs8" });
  } else {
    console.error("Error: Missing .keys/po-pilot-ed25519-private.pem or PO_PILOT_SIGNING_PRIVATE_KEY_B64. Run `--keygen` first.");
    process.exit(1);
  }

  const payload = {
    sub,
    tier,
    ...(days > 0 ? { exp: Math.floor(Date.now() / 1000) + Math.round(days * 86400) } : {})
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sigB64 = sign(null, Buffer.from(payloadB64, "utf8"), privateKey).toString("base64url");
  console.log(`POP1.${payloadB64}.${sigB64}`);
  process.exit(0);
}

console.log("Usage:\n  node scripts/mint-license.mjs --keygen\n  node scripts/mint-license.mjs --sign --sub <email> [--tier pro|agency|lifetime] [--days 365]");
