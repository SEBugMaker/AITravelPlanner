export interface TravelPreferences {
  destination: string;
  days: number;
  budgetCNY: number;
  companions: number;
  interests: string[];
}

export interface ItineraryDayPlan {
  day: number;
  summary: string;
  highlights: string[];
  meals?: string[];
  estimatedCost?: number;
}

export interface ItineraryPlan {
  overview: string;
  dayPlans: ItineraryDayPlan[];
  estimatedTotal: number;
}

export function summarizePreferences(prefs: TravelPreferences): string {
  const interests = prefs.interests.length > 0 ? prefs.interests.join("、") : "综合体验";
  return `目的地 ${prefs.destination}，${prefs.days} 天行程，预算约 ${prefs.budgetCNY} 元，${prefs.companions} 位同行，偏好 ${interests}`;
}

export function createSkeletonPlan(prefs: TravelPreferences): ItineraryPlan {
  return {
    overview: `为 ${summarizePreferences(prefs)} 创建的占位行程，等待 LLM 生成详细内容。`,
    dayPlans: Array.from({ length: prefs.days }, (_, index) => ({
      day: index + 1,
      summary: "行程生成中……",
      highlights: ["即将由大模型补全"],
      meals: [],
      estimatedCost: undefined
    })),
    estimatedTotal: prefs.budgetCNY
  };
}
