import { NextResponse } from "next/server";
import { z } from "zod";
import type { TravelPreferences } from "@core/index";
import { inferPreferencesFromText, normalizePreferences } from "../../../../lib/llm/preferences";
import { generateItinerary } from "../../../../lib/services/itinerary";
import { createSupabaseServerClient } from "../../../../lib/supabaseServer";

const fallbackSchema = z.object({
  destination: z.string().optional(),
  days: z.number().int().min(1).max(30).optional(),
  budgetCNY: z.number().min(0).optional(),
  companions: z.number().int().min(1).max(10).optional(),
  interests: z.array(z.string()).max(10).optional()
}).optional();

const requestSchema = z.object({
  content: z.string().min(1, "content is required"),
  persist: z.boolean().optional(),
  fallbackPreferences: fallbackSchema
});

const DEFAULT_SERVER_FALLBACK: TravelPreferences = {
  destination: "热门旅行目的地",
  days: 3,
  budgetCNY: 5000,
  companions: 2,
  interests: ["美食"]
};

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const parseResult = requestSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json({
        error: "INVALID_REQUEST",
        details: parseResult.error.flatten()
      }, { status: 400 });
    }

    const { content, persist = false, fallbackPreferences } = parseResult.data;

    const fallback: TravelPreferences = normalizePreferences({
      destination: fallbackPreferences?.destination ?? DEFAULT_SERVER_FALLBACK.destination,
      days: fallbackPreferences?.days ?? DEFAULT_SERVER_FALLBACK.days,
      budgetCNY: fallbackPreferences?.budgetCNY ?? DEFAULT_SERVER_FALLBACK.budgetCNY,
      companions: fallbackPreferences?.companions ?? DEFAULT_SERVER_FALLBACK.companions,
      interests: fallbackPreferences?.interests ?? DEFAULT_SERVER_FALLBACK.interests
    });

    const supabase = createSupabaseServerClient({ access: "write" });
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser();

    if (userError) {
      console.warn("[Itineraries/from-text] Failed to verify user", userError);
    }

    if (persist && !user) {
      return NextResponse.json({
        error: "UNAUTHORIZED",
        message: "请先登录后再保存到云端"
      }, { status: 401 });
    }

    const preferences = await inferPreferencesFromText(content, fallback);

    if (!preferences.destination || !preferences.destination.trim()) {
      return NextResponse.json({
        error: "DESTINATION_REQUIRED",
        message: "未能识别目的地，请补充更明确的旅行信息。"
      }, { status: 400 });
    }

    const { plan, source, note, itineraryId } = await generateItinerary(preferences, {
      persist,
      userId: user?.id ?? null
    });

    return NextResponse.json({
      plan,
      source,
      note,
      itineraryId,
      preferences
    }, { status: 200 });
  } catch (error) {
    console.error("Failed to generate itinerary from text", error);
    return NextResponse.json({
      error: "INTERNAL_ERROR",
      message: "行程生成失败，请稍后再试。"
    }, { status: 500 });
  }
}
