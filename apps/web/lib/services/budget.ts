import type { ItineraryPlan, TravelPreferences } from "@core/index";

export interface BudgetItem {
  category: "transport" | "accommodation" | "dining" | "activities" | "buffer";
  estimated: number;
  description: string;
}

export interface BudgetSummary {
  currency: string;
  total: number;
  items: BudgetItem[];
  dailyAverage: number;
}

const CATEGORY_WEIGHTS: Record<BudgetItem["category"], number> = {
  transport: 0.25,
  accommodation: 0.35,
  dining: 0.2,
  activities: 0.15,
  buffer: 0.05
};

export function estimateBudget(
  plan: ItineraryPlan,
  preferences: TravelPreferences,
  currency = "CNY"
): BudgetSummary {
  const baseTotal = plan.estimatedTotal || preferences.budgetCNY;
  const total = Math.max(baseTotal, preferences.budgetCNY);
  const items: BudgetItem[] = Object.entries(CATEGORY_WEIGHTS).map(([category, ratio]) => ({
    category: category as BudgetItem["category"],
    estimated: Math.round(total * ratio),
    description: describeCategory(category as BudgetItem["category"], preferences)
  }));

  return {
    currency,
    total,
    items,
    dailyAverage: Number((total / preferences.days).toFixed(2))
  };
}

function describeCategory(category: BudgetItem["category"], prefs: TravelPreferences) {
  switch (category) {
    case "transport":
      return `${prefs.destination} 市内交通与往返交通费用`;
    case "accommodation":
      return `${prefs.days} 晚舒适型住宿预算`;
    case "dining":
      return `${prefs.interests.includes("美食") ? "美食探索" : "日常餐饮"} 预算`;
    case "activities":
      return `${prefs.interests.join("、") || "常规活动"} 体验费用`;
    case "buffer":
      return "预留 5% 机动资金应对突发情况";
    default:
      return "旅行开销";
  }
}
