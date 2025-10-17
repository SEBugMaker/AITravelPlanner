import { NextResponse } from "next/server";
import { z } from "zod";
import type { ItineraryPlan, TravelPreferences } from "@core/index";
import { estimateBudget } from "../../../lib/services/budget";

const requestSchema = z.object({
  plan: z.object({
    overview: z.string(),
    estimatedTotal: z.number(),
    dayPlans: z.array(
      z.object({
        day: z.number().int().min(1),
        summary: z.string(),
        highlights: z.array(z.string()),
        meals: z.array(z.string()).optional(),
        estimatedCost: z.number().optional()
      })
    )
  }),
  preferences: z.object({
    destination: z.string(),
    days: z.number().int().min(1),
    budgetCNY: z.number().min(0),
    companions: z.number().int().min(1),
    interests: z.array(z.string())
  }),
  currency: z.string().optional()
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = requestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({
        error: "INVALID_REQUEST",
        details: parsed.error.flatten()
      }, { status: 400 });
    }

    const { plan, preferences, currency } = parsed.data as {
      plan: ItineraryPlan;
      preferences: TravelPreferences;
      currency?: string;
    };
    const summary = estimateBudget(plan, preferences, currency);

    return NextResponse.json(summary);
  } catch (error) {
    console.error("Budget estimation failed", error);
    return NextResponse.json({
      error: "INTERNAL_ERROR",
      message: "预算估算失败"
    }, { status: 500 });
  }
}
