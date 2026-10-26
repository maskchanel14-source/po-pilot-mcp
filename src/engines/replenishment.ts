import type { ReplenishmentItemResult, SkuSignal } from "../types.js";

const SERVICE_LEVEL_Z: Record<string, number> = {
  "85%": 1.04,
  "90%": 1.28,
  "95%": 1.65,
  "97.5%": 1.96,
  "99%": 2.33
};

export interface ReplenishmentSummary {
  total_skus_analyzed: number;
  critical_stockout_skus: number;
  reorder_now_skus: number;
  overstock_skus: number;
  total_recommended_spend_usd: number;
  items: ReplenishmentItemResult[];
}

/**
 * Computes ABC margin classification, stockout-adjusted daily velocity,
 * demand + lead-time variability safety stock, reorder point, and order quantities.
 */
export function computeReplenishmentPlan(
  signals: SkuSignal[],
  options: { serviceLevel?: string; reviewPeriodDays?: number } = {}
): ReplenishmentSummary {
  const zScore = SERVICE_LEVEL_Z[options.serviceLevel ?? "95%"] ?? 1.65;
  const reviewDays = Math.max(1, options.reviewPeriodDays ?? 14);

  const marginContributions = signals.map((s) => {
    const unitMargin = Math.max(0.01, s.retail_price_usd - s.unit_cost_usd);
    return { sku: s.sku, totalMargin: unitMargin * s.units_sold_window };
  });
  const grandMargin = marginContributions.reduce((acc, m) => acc + m.totalMargin, 0) || 1;
  const sortedMargins = [...marginContributions].sort((a, b) => b.totalMargin - a.totalMargin);

  const abcMap = new Map<string, "A" | "B" | "C">();
  let cumulative = 0;
  for (const entry of sortedMargins) {
    const prevShare = cumulative / grandMargin;
    cumulative += entry.totalMargin;
    if (prevShare < 0.8) abcMap.set(entry.sku, "A");
    else if (prevShare < 0.95) abcMap.set(entry.sku, "B");
    else abcMap.set(entry.sku, "C");
  }

  const items: ReplenishmentItemResult[] = signals.map((s) => {
    const activeDays = Math.max(1, s.window_days - Math.min(s.stockout_days, s.window_days - 1));
    const velocity = Number((s.units_sold_window / activeDays).toFixed(3));
    const sigmaD = s.daily_demand_std_dev ?? velocity * 0.35;
    const sigmaLt = s.lead_time_std_dev_days ?? 2;

    const safetyStock =
      velocity === 0
        ? 0
        : Math.ceil(zScore * Math.sqrt(s.lead_time_days * sigmaD ** 2 + velocity ** 2 * sigmaLt ** 2));

    const reorderPoint = Math.ceil(velocity * s.lead_time_days + safetyStock);
    const targetStock = Math.ceil(velocity * (s.lead_time_days + reviewDays) + safetyStock);
    const inventoryPosition = s.on_hand + s.on_order - s.committed - s.backorders;
    const daysOfCover = velocity > 0 ? Number(Math.max(0, inventoryPosition / velocity).toFixed(1)) : null;

    const rawShortfall = inventoryPosition <= reorderPoint ? Math.max(0, targetStock - inventoryPosition) : 0;
    let recommendedQty = 0;
    if (rawShortfall > 0) {
      const moqFloored = Math.max(rawShortfall, s.sku_moq);
      recommendedQty = Math.ceil(moqFloored / s.case_pack) * s.case_pack;
    }

    let risk: ReplenishmentItemResult["stockout_risk"] = "HEALTHY";
    if (daysOfCover !== null && daysOfCover <= s.lead_time_days && velocity > 0) risk = "CRITICAL";
    else if (inventoryPosition <= reorderPoint && velocity > 0) risk = "REORDER_NOW";
    else if (daysOfCover !== null && daysOfCover > 180) risk = "OVERSTOCK";
    else if (inventoryPosition <= Math.ceil(reorderPoint * 1.15) && velocity > 0) risk = "WATCH";

    return {
      sku: s.sku,
      title: s.title,
      vendor: s.vendor,
      abc_class: abcMap.get(s.sku) ?? "C",
      inventory_position: inventoryPosition,
      adjusted_daily_velocity: velocity,
      days_of_cover: daysOfCover,
      safety_stock_units: safetyStock,
      reorder_point_units: reorderPoint,
      target_stock_level: targetStock,
      raw_shortfall_units: rawShortfall,
      recommended_order_units: recommendedQty,
      estimated_line_cost_usd: Number((recommendedQty * s.unit_cost_usd).toFixed(2)),
      stockout_risk: risk,
      case_pack: s.case_pack,
      sku_moq: s.sku_moq,
      unit_cost_usd: s.unit_cost_usd,
      lead_time_days: s.lead_time_days
    };
  });

  return {
    total_skus_analyzed: items.length,
    critical_stockout_skus: items.filter((i) => i.stockout_risk === "CRITICAL").length,
    reorder_now_skus: items.filter((i) => i.stockout_risk === "REORDER_NOW").length,
    overstock_skus: items.filter((i) => i.stockout_risk === "OVERSTOCK").length,
    total_recommended_spend_usd: Number(items.reduce((acc, i) => acc + i.estimated_line_cost_usd, 0).toFixed(2)),
    items
  };
}
