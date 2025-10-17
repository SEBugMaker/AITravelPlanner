import {
  createSkeletonPlan,
  summarizePreferences,
  type ItineraryPlan,
  type TravelPreferences
} from "@core/index";
import { requestItineraryFromLLM } from "../llm/client";
import { getSupabaseAdminClient } from "../supabaseAdmin";

export interface GenerateItineraryOptions {
  userId?: string | null;
  persist?: boolean;
}

export interface GenerateItineraryResponse {
  plan: ItineraryPlan;
  source: "llm" | "fallback";
  note?: string;
  itineraryId?: string | null;
}

export async function generateItinerary(
  preferences: TravelPreferences,
  options: GenerateItineraryOptions = {}
): Promise<GenerateItineraryResponse> {
  const llmResult = await requestItineraryFromLLM(preferences);

  let plan: ItineraryPlan;
  let source: GenerateItineraryResponse["source"] = "fallback";
  let note: string | undefined;
  let itineraryId: string | null = null;

  if (llmResult.plan) {
    plan = normalizePlan(llmResult.plan, preferences);
    source = "llm";
  } else {
    plan = createFallbackPlan(preferences);
    note = "LLM 未配置或生成失败，返回默认行程骨架";
  }

  if (options.persist) {
    itineraryId = await persistItinerary(plan, preferences, options.userId ?? null);
  }

  return { plan, source, note, itineraryId };
}

function createFallbackPlan(preferences: TravelPreferences): ItineraryPlan {
  const skeleton = createSkeletonPlan(preferences);
  const fallbackHighlights = [
    "城市地标巡礼",
    "当地美食探店",
    "亲子互动体验",
    "购物与文化融合"
  ];

  const enriched = skeleton.dayPlans.map((dayPlan, idx) => ({
    ...dayPlan,
    summary: `${preferences.destination} 经典线路第 ${dayPlan.day} 天`,
    highlights: [fallbackHighlights[idx % fallbackHighlights.length]],
    meals: ["早餐：酒店自助", "午餐：特色餐厅", "晚餐：本地必吃"]
  }));

  return {
    overview: `为 ${summarizePreferences(preferences)} 生成的默认行程，可在获取真实 LLM 响应前使用。`,
    dayPlans: enriched,
    estimatedTotal: preferences.budgetCNY
  };
}

function normalizePlan(plan: ItineraryPlan, preferences: TravelPreferences): ItineraryPlan {
  const dayCount = Math.min(plan.dayPlans.length, preferences.days);
  const normalizedDayPlans = plan.dayPlans.slice(0, dayCount).map((dayPlan, index) => ({
    day: index + 1,
    summary: dayPlan.summary ?? `${preferences.destination} 行程第 ${index + 1} 天`,
    highlights: dayPlan.highlights?.length ? dayPlan.highlights : ["自由活动"],
    meals: dayPlan.meals ?? [],
    estimatedCost: dayPlan.estimatedCost
  }));

  return {
    overview: plan.overview ?? summarizePreferences(preferences),
    dayPlans: normalizedDayPlans,
    estimatedTotal: plan.estimatedTotal ?? preferences.budgetCNY
  };
}

async function persistItinerary(
  plan: ItineraryPlan,
  preferences: TravelPreferences,
  userId: string | null
): Promise<string | null> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    console.warn("Supabase admin client unavailable, skip persisting itinerary");
    return null;
  }

  const payload = {
    user_id: userId,
    plan,
    preferences,
    source: "api",
    created_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("itineraries")
    .insert(payload)
    .select("id")
    .single();
  if (error) {
    console.error("Failed to persist itinerary", error);
    return null;
  }

  return data?.id ?? null;
}
