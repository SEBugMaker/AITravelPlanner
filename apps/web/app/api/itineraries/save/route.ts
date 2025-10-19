import { NextResponse } from "next/server";
import { z } from "zod";
import type { TravelPreferences } from "@core/index";
import { normalizePreferences } from "../../../../lib/llm/preferences";
import { createSupabaseServerClient } from "../../../../lib/supabaseServer";

const stringArray = z.array(z.string().min(1)).max(20).default([]);

const locationSchema = z.object({
  name: z.string().min(1),
  latitude: z.number().finite().optional(),
  longitude: z.number().finite().optional(),
  address: z.string().min(1).optional()
});

const transportationSchema = z.object({
  mode: z.string().min(1),
  origin: z.string().min(1).optional(),
  destination: z.string().min(1).optional(),
  departureTime: z.string().min(1).optional(),
  arrivalTime: z.string().min(1).optional(),
  duration: z.string().min(1).optional(),
  detail: z.string().min(1).optional(),
  costEstimate: z.number().finite().optional()
});

const accommodationSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1).optional(),
  checkIn: z.string().min(1).optional(),
  checkOut: z.string().min(1).optional(),
  costEstimate: z.number().finite().optional(),
  notes: z.string().min(1).optional()
});

const restaurantSchema = z.object({
  name: z.string().min(1),
  cuisine: z.string().min(1).optional(),
  mustTry: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  reservation: z.boolean().optional(),
  budgetPerPerson: z.number().finite().optional(),
  time: z.string().min(1).optional()
});

const dayPlanSchema = z
  .object({
    day: z.number().int().min(1),
    summary: z.string().min(1),
    highlights: stringArray.optional(),
    meals: stringArray.optional(),
    estimatedCost: z.number().finite().optional(),
    locations: z.array(locationSchema).optional(),
    transportation: z.array(transportationSchema).optional(),
    accommodation: accommodationSchema.optional().nullable(),
    restaurants: z.array(restaurantSchema).optional()
  })
  .passthrough();

const planSchema = z
  .object({
    overview: z.string().default(""),
    dayPlans: z.array(dayPlanSchema).default([]),
    estimatedTotal: z.number().finite().nonnegative().optional()
  })
  .passthrough();

const preferencesSchema = z.object({
  destination: z.string().min(1),
  days: z.number().int().min(1).max(30),
  budgetCNY: z.number().finite().nonnegative(),
  companions: z.number().int().min(1).max(10),
  interests: z.array(z.string().min(1)).max(10)
});

const requestSchema = z.object({
  plan: planSchema,
  preferences: preferencesSchema,
  itineraryId: z.string().min(1).optional()
});

export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => null);
    const parseResult = requestSchema.safeParse(payload);

    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: "INVALID_REQUEST",
          details: parseResult.error.flatten()
        },
        { status: 400 }
      );
    }

    const { plan, preferences, itineraryId } = parseResult.data;
    const normalizedPreferences = normalizePreferences(preferences as TravelPreferences);

    const sanitizedPlan = {
      ...plan,
      overview: plan.overview ?? "",
      dayPlans: Array.isArray(plan.dayPlans) ? plan.dayPlans : [],
      estimatedTotal: typeof plan.estimatedTotal === "number" && Number.isFinite(plan.estimatedTotal)
        ? Math.max(0, plan.estimatedTotal)
        : normalizedPreferences.budgetCNY
    };

    const supabase = createSupabaseServerClient({ access: "write" });
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser();

    if (userError) {
      console.warn("[Itineraries/save] Failed to verify user", userError);
    }

    if (!user) {
      return NextResponse.json(
        {
          error: "UNAUTHORIZED",
          message: "请先登录后再保存到云端"
        },
        { status: 401 }
      );
    }

    const baseRecord = {
      user_id: user.id,
      plan: sanitizedPlan,
      preferences: normalizedPreferences,
      source: "manual-save"
    };

    if (itineraryId) {
      const { error } = await supabase
        .from("itineraries")
        .update(baseRecord)
        .eq("id", itineraryId)
        .eq("user_id", user.id);

      if (error) {
        console.error("Failed to update itinerary", error);
        return NextResponse.json(
          {
            error: "SUPABASE_ERROR",
            message: "更新云端行程失败"
          },
          { status: 500 }
        );
      }

      return NextResponse.json({ itineraryId, action: "updated" }, { status: 200 });
    }

    const { data, error } = await supabase
      .from("itineraries")
      .insert({
        ...baseRecord,
        created_at: new Date().toISOString()
      })
      .select("id")
      .single();

    if (error) {
      console.error("Failed to save itinerary", error);
      return NextResponse.json(
        {
          error: "SUPABASE_ERROR",
          message: "保存云端行程失败"
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ itineraryId: data.id, action: "created" }, { status: 200 });
  } catch (error) {
    console.error("Unhandled itinerary save error", error);
    return NextResponse.json(
      {
        error: "INTERNAL_ERROR",
        message: "保存云端行程失败"
      },
      { status: 500 }
    );
  }
}
