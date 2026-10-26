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
      barcode
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
          currentQuantity
        }
      }
    }
  }
}
`;

const MAX_VARIANT_PAGES = 10; // up to 2,500 SKUs
const MAX_ORDER_PAGES = 20;   // up to 5,000 paid orders per lookback window

function stripEnvQuotes(val: string | undefined): string {
  if (!val) return "";
  return val.trim().replace(/^(['"])(.*)\1$/, "$2").trim();
}

export function resolveShopifyConfig(): ShopifyLiveConfig | null {
  const rawDomain = stripEnvQuotes(process.env.SHOPIFY_STORE_DOMAIN);
  const accessToken = stripEnvQuotes(process.env.SHOPIFY_ACCESS_TOKEN);
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
    apiVersion: stripEnvQuotes(process.env.SHOPIFY_API_VERSION) || "2026-04"
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
  const ordersQuery = `created_at:>=${sinceIso} (financial_status:paid OR financial_status:partially_refunded OR financial_status:partially_paid) -status:cancelled`;

  // 1. Paginate paid orders across lookback window (using net currentQuantity to exclude refunded units)
  const soldBySku = new Map<string, number>();
  let orderCursor: string | null = null;
  for (let page = 0; page < MAX_ORDER_PAGES; page++) {
    const orderData: {
      orders?: {
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
        nodes?: Array<{
          lineItems?: {
            nodes?: Array<{ sku: string | null; quantity: number; currentQuantity?: number | null }>;
          };
        }>;
      };
    } = await postShopifyGraphql(endpoint, config.accessToken, ORDERS_PAGE_QUERY, {
      ordersQuery,
      cursor: orderCursor
    });

    for (const order of orderData.orders?.nodes ?? []) {
      for (const item of order.lineItems?.nodes ?? []) {
        const sku = item.sku?.trim();
        const netQty = typeof item.currentQuantity === "number" ? item.currentQuantity : item.quantity;
        if (sku && netQty > 0) {
          const skuKey = sku.toUpperCase();
          soldBySku.set(skuKey, (soldBySku.get(skuKey) ?? 0) + netQty);
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
          barcode?: string | null;
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
      const skuKey = sku.toUpperCase();
      const retail = Math.max(0, Number(v.price) || 0);
      const rawCost = Number(v.inventoryItem?.unitCost?.amount);
      const unitCost = Number.isFinite(rawCost) && rawCost > 0 ? rawCost : Number((retail * 0.4).toFixed(2));
      const variantSuffix = v.title && v.title !== "Default Title" ? ` - ${v.title}` : "";

      const existing = signalsBySku.get(skuKey);
      if (existing) {
        existing.on_hand += v.inventoryQuantity ?? 0;
        if (!existing.barcode && v.barcode?.trim()) {
          existing.barcode = v.barcode.trim();
        }
        continue;
      }

      const cleanBarcode = v.barcode?.trim();
      signalsBySku.set(skuKey, {
        sku,
        ...(cleanBarcode ? { barcode: cleanBarcode } : {}),
        title: `${v.product.title}${variantSuffix}`,
        vendor: v.product.vendor || "Unassigned Vendor",
        on_hand: v.inventoryQuantity ?? 0,
        committed: 0,
        on_order: 0,
        backorders: 0,
        units_sold_window: soldBySku.get(skuKey) ?? 0,
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
