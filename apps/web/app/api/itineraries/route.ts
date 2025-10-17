import { NextResponse } from "next/server";
import { z } from "zod";
import type { TravelPreferences } from "@core/index";
import { generateItinerary } from "../../../lib/services/itinerary";
import { createSupabaseServerClient } from "../../../lib/supabaseServer";

const requestSchema = z.object({
  destination: z.string().min(1),
  days: z.number().int().min(1).max(30),
  budgetCNY: z.number().min(0),
  companions: z.number().int().min(1).max(10),
  interests: z.array(z.string()).max(10),
  persist: z.boolean().optional()
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const parseResult = requestSchema.safeParse(json);

    if (!parseResult.success) {
      return NextResponse.json({
        error: "INVALID_REQUEST",
        details: parseResult.error.flatten()
      }, { status: 400 });
    }

    const { persist = false, ...rest } = parseResult.data;
    const preferences = rest as TravelPreferences;

    const supabase = createSupabaseServerClient();
    const {
      data: { session }
    } = await supabase.auth.getSession();

    if (persist && !session) {
      return NextResponse.json({
        error: "UNAUTHORIZED",
        message: "请先登录后再保存到云端"
      }, { status: 401 });
    }

    const userId = session?.user?.id ?? null;
    const { plan, source, note, itineraryId } = await generateItinerary(preferences, {
      persist,
      userId
    });

    return NextResponse.json({ plan, source, note, itineraryId });
  } catch (error) {
    console.error("Failed to generate itinerary", error);
    return NextResponse.json({
      error: "INTERNAL_ERROR",
      message: "无法生成行程，请稍后再试"
    }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const supabase = createSupabaseServerClient();
    const {
      data: { session }
    } = await supabase.auth.getSession();

    if (!session) {
      return NextResponse.json({
        error: "UNAUTHORIZED",
        message: "请先登录后查看云端行程"
      }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? Math.min(Number.parseInt(limitParam, 10) || 0, 50) : 20;

    const { data, error } = await supabase
      .from("itineraries")
      .select("id, plan, preferences, source, created_at")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(limit > 0 ? limit : 20);

    if (error) {
      console.error("Failed to fetch itineraries", error);
      return NextResponse.json({
        error: "SUPABASE_ERROR",
        message: "获取云端行程失败"
      }, { status: 500 });
    }

    return NextResponse.json({ itineraries: data ?? [] }, { status: 200 });
  } catch (error) {
    console.error("Unhandled itineraries fetch error", error);
    return NextResponse.json({
      error: "INTERNAL_ERROR",
      message: "获取云端行程失败"
    }, { status: 500 });
  }
}

const deleteSchema = z.object({
  id: z.string().min(1, "id is required")
});

export async function DELETE(request: Request) {
  try {
    const supabase = createSupabaseServerClient();
    const {
      data: { session }
    } = await supabase.auth.getSession();

    if (!session) {
      return NextResponse.json({
        error: "UNAUTHORIZED",
        message: "请先登录后再删除云端行程"
      }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const parseResult = deleteSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json({
        error: "INVALID_REQUEST",
        details: parseResult.error.flatten()
      }, { status: 400 });
    }

    const { id } = parseResult.data;
    const { error } = await supabase
      .from("itineraries")
      .delete()
      .eq("id", id)
      .eq("user_id", session.user.id);

    if (error) {
      console.error("Failed to delete itinerary", error);
      return NextResponse.json({
        error: "SUPABASE_ERROR",
        message: "删除云端行程失败"
      }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("Unhandled itinerary delete error", error);
    return NextResponse.json({
      error: "INTERNAL_ERROR",
      message: "删除云端行程失败"
    }, { status: 500 });
  }
}
