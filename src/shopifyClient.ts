import type { SkuSignal } from "./types.js";

export interface ShopifyLiveConfig {
  storeDomain: string;
  accessToken: string;
  apiVersion?: string;
}

const VARIANTS_AND_ORDERS_QUERY = `
query PoPilotReplenishmentSnapshot($ordersQuery: String!) {
  productVariants(first: 100) {
    nodes {
      sku
      title
      price
      inventoryQuantity
      product {
        title
        vendor
        status
      }
      inventoryItem {
        unitCost {
          amount
        }
      }
    }
  }
  orders(first: 100, query: $ordersQuery) {
    nodes {
      lineItems(first: 50) {
        nodes {
          sku
          quantity
        }
      }
    }
  }
}
`;

export function resolveShopifyConfig(): ShopifyLiveConfig | null {
  const rawDomain = process.env.SHOPIFY_STORE_DOMAIN?.trim();
  const accessToken = process.env.SHOPIFY_ACCESS_TOKEN?.trim();
  if (!rawDomain || !accessToken) return null;

  const cleanDomain = rawDomain.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!/^[a-z0-9][a-z0-9.-]*\.myshopify\.com$/i.test(cleanDomain)) {
    throw new Error(
      `Invalid SHOPIFY_STORE_DOMAIN "${cleanDomain}". Expected format: your-store.myshopify.com`
    );
  }

  return {
    storeDomain: cleanDomain,
    accessToken,
    apiVersion: process.env.SHOPIFY_API_VERSION?.trim() || "2026-04"
  };
}

/**
 * Fetches live active variants + recent sales velocity from Shopify Admin GraphQL API.
 * Never logs or echoes credentials.
 */
export async function fetchLiveShopifySignals(
  config: ShopifyLiveConfig,
  windowDays = 30,
  defaultLeadTimeDays = 14
): Promise<SkuSignal[]> {
  const sinceIso = new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 10);
  const endpoint = `https://${config.storeDomain}/admin/api/${config.apiVersion ?? "2026-04"}/graphql.json`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": config.accessToken
    },
    body: JSON.stringify({
      query: VARIANTS_AND_ORDERS_QUERY,
      variables: { ordersQuery: `created_at:>=${sinceIso} financial_status:paid` }
    }),
    signal: AbortSignal.timeout(15_000)
  });

  if (!response.ok) {
    throw new Error(
      `Shopify Admin GraphQL returned HTTP ${response.status}. Verify SHOPIFY_STORE_DOMAIN and read_products/read_inventory/read_orders scopes.`
    );
  }

  const payload = (await response.json()) as {
    data?: {
      productVariants?: {
        nodes?: Array<{
          sku: string | null;
          title: string;
          price: string;
          inventoryQuantity: number | null;
          product: { title: string; vendor: string; status: string };
          inventoryItem?: { unitCost?: { amount?: string } | null } | null;
        }>;
      };
      orders?: {
        nodes?: Array<{
          lineItems?: { nodes?: Array<{ sku: string | null; quantity: number }> };
        }>;
      };
    };
    errors?: Array<{ message: string }>;
  };

  if (payload.errors?.length) {
    throw new Error(`Shopify GraphQL error: ${payload.errors[0].message}`);
  }

  const soldBySku = new Map<string, number>();
  for (const order of payload.data?.orders?.nodes ?? []) {
    for (const item of order.lineItems?.nodes ?? []) {
      if (item.sku) {
        soldBySku.set(item.sku, (soldBySku.get(item.sku) ?? 0) + (item.quantity ?? 0));
      }
    }
  }

  const signals: SkuSignal[] = [];
  for (const v of payload.data?.productVariants?.nodes ?? []) {
    if (!v.sku || v.product.status !== "ACTIVE") continue;
    const retail = Number(v.price) || 0;
    const rawCost = Number(v.inventoryItem?.unitCost?.amount);
    const unitCost = Number.isFinite(rawCost) && rawCost > 0 ? rawCost : Number((retail * 0.4).toFixed(2));
    const variantSuffix = v.title && v.title !== "Default Title" ? ` - ${v.title}` : "";

    signals.push({
      sku: v.sku,
      title: `${v.product.title}${variantSuffix}`,
      vendor: v.product.vendor || "Unassigned Vendor",
      on_hand: v.inventoryQuantity ?? 0,
      committed: 0,
      on_order: 0,
      backorders: 0,
      units_sold_window: soldBySku.get(v.sku) ?? 0,
      window_days: windowDays,
      stockout_days: 0,
      unit_cost_usd: unitCost,
      retail_price_usd: retail,
      lead_time_days: defaultLeadTimeDays,
      lead_time_std_dev_days: 2,
      case_pack: 1,
      sku_moq: 1
    });
  }

  return signals;
}
