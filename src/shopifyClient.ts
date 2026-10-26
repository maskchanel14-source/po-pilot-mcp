import type { SkuSignal } from "./types.js";

export interface ShopifyLiveConfig {
  storeDomain: string;
  accessToken: string;
  apiVersion?: string;
  baseUrlOverride?: string;
}

const VARIANTS_PAGE_QUERY = `
query PoPilotVariantsPage($cursor: String) {
  productVariants(first: 250, after: $cursor) {
    pageInfo {
      hasNextPage
      endCursor
    }
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
}
`;

const ORDERS_PAGE_QUERY = `
query PoPilotOrdersPage($ordersQuery: String!, $cursor: String) {
  orders(first: 250, after: $cursor, query: $ordersQuery) {
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      lineItems(first: 250) {
        nodes {
          sku
          quantity
        }
      }
    }
  }
}
`;

const MAX_VARIANT_PAGES = 10; // up to 2,500 SKUs
const MAX_ORDER_PAGES = 20;   // up to 5,000 paid orders per lookback window

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

async function postShopifyGraphql<T>(
  endpoint: string,
  accessToken: string,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000)
  });

  if (!response.ok) {
    throw new Error(
      `Shopify Admin GraphQL returned HTTP ${response.status}. Verify SHOPIFY_STORE_DOMAIN and read_products/read_inventory/read_orders scopes.`
    );
  }

  const payload = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };

  if (payload.errors?.length) {
    throw new Error(`Shopify GraphQL error: ${payload.errors[0].message}`);
  }
  if (!payload.data) {
    throw new Error("Shopify GraphQL returned an empty data payload.");
  }

  return payload.data;
}

/**
 * Fetches live active variants + recent paid sales velocity across paginated GraphQL pages.
 * Never logs or echoes credentials.
 */
export async function fetchLiveShopifySignals(
  config: ShopifyLiveConfig,
  windowDays = 30,
  defaultLeadTimeDays = 14
): Promise<SkuSignal[]> {
  const sinceIso = new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 10);
  const base = config.baseUrlOverride
    ? config.baseUrlOverride.replace(/\/+$/, "")
    : `https://${config.storeDomain}`;
  const endpoint = `${base}/admin/api/${config.apiVersion ?? "2026-04"}/graphql.json`;
  const ordersQuery = `created_at:>=${sinceIso} financial_status:paid -status:cancelled`;

  // 1. Paginate paid orders across lookback window
  const soldBySku = new Map<string, number>();
  let orderCursor: string | null = null;
  for (let page = 0; page < MAX_ORDER_PAGES; page++) {
    const orderData: {
      orders?: {
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
        nodes?: Array<{
          lineItems?: { nodes?: Array<{ sku: string | null; quantity: number }> };
        }>;
      };
    } = await postShopifyGraphql(endpoint, config.accessToken, ORDERS_PAGE_QUERY, {
      ordersQuery,
      cursor: orderCursor
    });

    for (const order of orderData.orders?.nodes ?? []) {
      for (const item of order.lineItems?.nodes ?? []) {
        const sku = item.sku?.trim();
        if (sku && item.quantity > 0) {
          soldBySku.set(sku, (soldBySku.get(sku) ?? 0) + item.quantity);
        }
      }
    }

    const pageInfo = orderData.orders?.pageInfo;
    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
    orderCursor = pageInfo.endCursor;
  }

  // 2. Paginate active product variants
  const signalsBySku = new Map<string, SkuSignal>();
  let variantCursor: string | null = null;
  for (let page = 0; page < MAX_VARIANT_PAGES; page++) {
    const variantData: {
      productVariants?: {
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
        nodes?: Array<{
          sku: string | null;
          title: string;
          price: string;
          inventoryQuantity: number | null;
          product: { title: string; vendor: string; status: string };
          inventoryItem?: { unitCost?: { amount?: string } | null } | null;
        }>;
      };
    } = await postShopifyGraphql(endpoint, config.accessToken, VARIANTS_PAGE_QUERY, {
      cursor: variantCursor
    });

    for (const v of variantData.productVariants?.nodes ?? []) {
      const sku = v.sku?.trim();
      if (!sku || v.product.status !== "ACTIVE") continue;
      const retail = Math.max(0, Number(v.price) || 0);
      const rawCost = Number(v.inventoryItem?.unitCost?.amount);
      const unitCost = Number.isFinite(rawCost) && rawCost > 0 ? rawCost : Number((retail * 0.4).toFixed(2));
      const variantSuffix = v.title && v.title !== "Default Title" ? ` - ${v.title}` : "";

      const existing = signalsBySku.get(sku);
      if (existing) {
        existing.on_hand += v.inventoryQuantity ?? 0;
        continue;
      }

      signalsBySku.set(sku, {
        sku,
        title: `${v.product.title}${variantSuffix}`,
        vendor: v.product.vendor || "Unassigned Vendor",
        on_hand: v.inventoryQuantity ?? 0,
        committed: 0,
        on_order: 0,
        backorders: 0,
        units_sold_window: soldBySku.get(sku) ?? 0,
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

    const pageInfo = variantData.productVariants?.pageInfo;
    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
    variantCursor = pageInfo.endCursor;
  }

  return [...signalsBySku.values()];
}
