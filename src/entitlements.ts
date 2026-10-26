import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

export const FREE_LOCAL_MAX_SKUS = 25;
export const FREE_LOCAL_MAX_INVOICE_LINES = 15;

/**
 * Optional creator Ed25519 SPKI public key (base64 DER) for offline `POP1.*` license tokens.
 * Generate your own keypair locally with `node scripts/mint-license.mjs --keygen` (private key stays in `.keys/`).
 * Polar.sh license keys (`<polar_org_uuid>:<license_key>`) work immediately without any offline keypair.
 */
export const DEFAULT_PUBLIC_KEY_SPKI_B64 = "";

export const DEFAULT_POLAR_ORGANIZATION_ID = "451b88fb-d285-4c16-b86c-9a8cb33fb09c";
export const POLAR_SOLO_CHECKOUT_URL =
  "https://buy.polar.sh/polar_cl_CjxzvoIki9VjrF1GLL4o7dwAnq4DIkr7ON42M2NHQzV";
export const MCPIZE_CLOUD_URL = "https://mcpize.com/mcp/po-pilot-mcp";

export const UPGRADE_NOTICE =
  `Free Local Sandbox processes up to 25 SKUs (and 15 invoice lines) per call. Unlock Unlimited SKUs, full catalog PO runs, Open-to-Buy cashflow optimization, 3 pre-built n8n workflows, and Live Shopify Admin GraphQL with a $49 Early-Bird License Key on Polar.sh (${POLAR_SOLO_CHECKOUT_URL} — set PO_PILOT_LICENSE_KEY) or subscribe to PO Pilot Cloud Pro ($29/mo) / Agency ($79/mo) on MCPize (${MCPIZE_CLOUD_URL}).`;

export interface LicensePayload {
  sub: string;
  tier: "pro" | "agency" | "lifetime";
  exp?: number;
}

export interface EntitlementResult {
  unlocked: boolean;
  tier: "free_local" | "pro" | "agency" | "lifetime";
  source: "none" | "ed25519_offline" | "polar_api" | "invalid";
  reason?: string;
  transient?: boolean;
}

interface CacheEntry {
  result: EntitlementResult;
  expiresAtMs: number;
}

const GRANTED_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour for valid keys
const REJECTED_CACHE_TTL_MS = 60 * 1000;     // 60 seconds for definitively invalid keys
const entitlementCache = new Map<string, CacheEntry>();

export function clearEntitlementCache(): void {
  entitlementCache.clear();
}

export function mintEd25519LicenseToken(payload: LicensePayload, privateKeyPkcs8Pem: string): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const privKey = createPrivateKey({ key: privateKeyPkcs8Pem, format: "pem", type: "pkcs8" });
  const signature = sign(null, Buffer.from(payloadB64, "utf8"), privKey).toString("base64url");
  return `POP1.${payloadB64}.${signature}`;
}

function verifyEd25519Token(token: string, publicKeySpkiB64: string): EntitlementResult {
  if (!publicKeySpkiB64) {
    return { unlocked: false, tier: "free_local", source: "invalid", reason: "missing_public_key" };
  }
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "POP1") {
    return { unlocked: false, tier: "free_local", source: "invalid", reason: "malformed_pop1_token" };
  }

  try {
    const [, payloadB64, sigB64] = parts;
    const pubDer = Buffer.from(publicKeySpkiB64, "base64");
    const pubKey = createPublicKey({ key: pubDer, format: "der", type: "spki" });
    const isValid = verify(
      null,
      Buffer.from(payloadB64, "utf8"),
      pubKey,
      Buffer.from(sigB64, "base64url")
    );
    if (!isValid) {
      return { unlocked: false, tier: "free_local", source: "invalid", reason: "bad_signature" };
    }

    const parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as {
      sub?: string;
      tier?: string;
      exp?: number | string;
    };
    if (parsed.exp !== undefined) {
      let expSeconds: number;
      if (typeof parsed.exp === "number") {
        expSeconds = parsed.exp;
      } else if (typeof parsed.exp === "string") {
        const parsedMs = Date.parse(parsed.exp);
        expSeconds = Number.isFinite(parsedMs) ? Math.floor(parsedMs / 1000) : -1;
      } else {
        expSeconds = -1;
      }
      if (!Number.isFinite(expSeconds) || Math.floor(Date.now() / 1000) > expSeconds) {
        return { unlocked: false, tier: "free_local", source: "invalid", reason: "license_expired" };
      }
    }

    const tier = parsed.tier === "agency" || parsed.tier === "lifetime" ? parsed.tier : "pro";
    return { unlocked: true, tier, source: "ed25519_offline" };
  } catch {
    return { unlocked: false, tier: "free_local", source: "invalid", reason: "verification_exception" };
  }
}

async function validatePolarLicenseKey(
  organizationId: string,
  key: string,
  apiBaseUrl: string
): Promise<EntitlementResult> {
  const endpoint = `${apiBaseUrl.replace(/\/+$/, "")}/v1/customer-portal/license-keys/validate`;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ key, organization_id: organizationId }),
      signal: AbortSignal.timeout(5000)
    });

    if (response.status === 429 || response.status >= 500) {
      return {
        unlocked: false,
        tier: "free_local",
        source: "invalid",
        reason: `polar_http_${response.status}`,
        transient: true
      };
    }

    if (!response.ok) {
      return { unlocked: false, tier: "free_local", source: "invalid", reason: `polar_http_${response.status}` };
    }

    const data = (await response.json()) as { status?: string };
    if (data.status === "granted") {
      return { unlocked: true, tier: "pro", source: "polar_api" };
    }
    return { unlocked: false, tier: "free_local", source: "invalid", reason: `polar_status_${data.status ?? "unknown"}` };
  } catch {
    return {
      unlocked: false,
      tier: "free_local",
      source: "invalid",
      reason: "polar_network_error",
      transient: true
    };
  }
}

function stripEnvQuotes(val: string): string {
  const trimmed = val.trim();
  return trimmed.replace(/^(['"])(.*)\1$/, "$2").trim();
}

export async function resolveEntitlement(options?: {
  licenseKey?: string;
  polarOrganizationId?: string;
  publicKeySpkiB64?: string;
  polarApiBaseUrl?: string;
}): Promise<EntitlementResult> {
  const rawKey = stripEnvQuotes(
    options?.licenseKey ??
      process.env.PO_PILOT_LICENSE_KEY ??
      process.env.PO_PILOT_SERVER_LICENSE_KEY ??
      ""
  );

  if (!rawKey) {
    return { unlocked: false, tier: "free_local", source: "none", reason: "no_license_key" };
  }

  const publicKeySpkiB64 = stripEnvQuotes(
    options?.publicKeySpkiB64 ??
      process.env.PO_PILOT_PUBLIC_KEY_SPKI_B64 ??
      DEFAULT_PUBLIC_KEY_SPKI_B64
  );
  const polarOrgEnv = stripEnvQuotes(
    options?.polarOrganizationId ??
      process.env.PO_PILOT_POLAR_ORG_ID ??
      process.env.POLAR_ORGANIZATION_ID ??
      DEFAULT_POLAR_ORGANIZATION_ID
  );
  const polarBase = stripEnvQuotes(options?.polarApiBaseUrl ?? process.env.POLAR_API_BASE_URL ?? "https://api.polar.sh");

  const cacheKey = `${rawKey}|${polarOrgEnv}|${publicKeySpkiB64}|${polarBase}`;
  const cached = entitlementCache.get(cacheKey);
  if (cached && cached.expiresAtMs > Date.now()) {
    return cached.result;
  }

  let result: EntitlementResult;
  if (rawKey.startsWith("POP1.")) {
    result = verifyEd25519Token(rawKey, publicKeySpkiB64);
  } else {
    let orgId = polarOrgEnv;
    let licenseKey = rawKey;
    const colonIdx = rawKey.indexOf(":");
    if (colonIdx > 0) {
      orgId = rawKey.slice(0, colonIdx).trim();
      licenseKey = rawKey.slice(colonIdx + 1).trim();
    }

    if (!orgId || !licenseKey) {
      result = {
        unlocked: false,
        tier: "free_local",
        source: "invalid",
        reason: "missing_polar_organization_id"
      };
    } else {
      result = await validatePolarLicenseKey(orgId, licenseKey, polarBase);
    }
  }

  // Never poison cache on transient Wi-Fi / HTTP 5xx / 429 failures
  if (!result.transient) {
    entitlementCache.set(cacheKey, {
      result,
      expiresAtMs: Date.now() + (result.unlocked ? GRANTED_CACHE_TTL_MS : REJECTED_CACHE_TTL_MS)
    });
  }

  return result;
}
