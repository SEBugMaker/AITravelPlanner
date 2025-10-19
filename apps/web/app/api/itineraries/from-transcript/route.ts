import { NextResponse } from "next/server";
import { z } from "zod";
import type { TravelPreferences } from "@core/index";
import { generateItinerary } from "../../../../lib/services/itinerary";
import { createSupabaseServerClient } from "../../../../lib/supabaseServer";
import {
  buildTravelPreferencesFromParsed,
  defaultTravelPreferences,
  parsePreferencesFromText
} from "../../../../lib/services/preferences";

const requestSchema = z.object({
  transcript: z.string().min(1, "transcript is required"),
  persist: z.boolean().optional()
});

export async function POST(request: Request) {
  try {
    const json = await request.json().catch(() => null);
    const parsedRequest = requestSchema.safeParse(json);

    if (!parsedRequest.success) {
      return NextResponse.json(
        {
          error: "INVALID_REQUEST",
          details: parsedRequest.error.flatten()
        },
        { status: 400 }
      );
    }

    const { transcript, persist = false } = parsedRequest.data;

    const supabase = createSupabaseServerClient({ access: "write" });
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser();

    if (userError) {
      console.warn("[Itineraries] Failed to verify user for transcript POST", userError);
    }

    if (persist && !user) {
      return NextResponse.json(
        {
          error: "UNAUTHORIZED",
          message: "请先登录后再保存到云端"
        },
        { status: 401 }
      );
    }

    const parsedPreferences = parsePreferencesFromText(transcript);
    const preferences = buildTravelPreferencesFromParsed(parsedPreferences);

    if (!preferences) {
      return NextResponse.json(
        {
          error: "PREFERENCES_INCOMPLETE",
          message: "无法从语音内容提取目的地，请手动确认后再试。",
          parsedPreferences
        },
        { status: 422 }
      );
    }

    const fallbackFields: Array<keyof TravelPreferences> = [];
    if (!parsedPreferences.days) fallbackFields.push("days");
    if (!parsedPreferences.budgetCNY) fallbackFields.push("budgetCNY");
    if (!parsedPreferences.companions) fallbackFields.push("companions");
    if (!parsedPreferences.interests || parsedPreferences.interests.length === 0) fallbackFields.push("interests");

    const shouldPersist = persist && Boolean(user);
    const { plan, source, note, itineraryId } = await generateItinerary(preferences, {
      persist: shouldPersist,
      userId: user?.id ?? null
    });

    return NextResponse.json(
      {
        plan,
        source,
        note,
        itineraryId,
        preferences,
        parsedPreferences,
        usedFallback: fallbackFields.length > 0,
        fallbackFields,
        defaults: defaultTravelPreferences
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Failed to handle transcript itinerary", error);
    return NextResponse.json(
      {
        error: "INTERNAL_ERROR",
        message: "无法生成行程，请稍后再试"
      },
      { status: 500 }
    );
  }
}
