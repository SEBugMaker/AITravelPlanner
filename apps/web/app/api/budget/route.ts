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
        estimatedCost: z.number().optional(),
        locations: z.array(
          z.object({
            name: z.string(),
            latitude: z.number().optional(),
            longitude: z.number().optional(),
            address: z.string().optional()
          })
        ),
        transportation: z.array(
          z.object({
            mode: z.string(),
            origin: z.string().optional(),
            destination: z.string().optional(),
            departureTime: z.string().optional(),
            arrivalTime: z.string().optional(),
            duration: z.string().optional(),
            detail: z.string().optional(),
            costEstimate: z.number().optional()
          })
        ).optional(),
        accommodation: z
          .object({
            name: z.string(),
            address: z.string().optional(),
            checkIn: z.string().optional(),
            checkOut: z.string().optional(),
            notes: z.string().optional(),
            costEstimate: z.number().optional()
          })
          .nullable()
          .optional(),
        restaurants: z.array(
          z.object({
            name: z.string(),
            cuisine: z.string().optional(),
            mustTry: z.string().optional(),
            address: z.string().optional(),
            reservation: z.boolean().optional(),
            budgetPerPerson: z.number().optional(),
            time: z.string().optional()
          })
        ).optional()
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
