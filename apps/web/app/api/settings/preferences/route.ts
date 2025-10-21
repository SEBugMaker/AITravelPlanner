import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../../lib/supabaseServer";

const preferencesSchema = z.object({
  defaultTravelDays: z.number().int().min(1).max(30),
  defaultBudgetCNY: z.number().min(0).max(1_000_000_000),
  voiceAssistEnabled: z.boolean(),
  autoPersistItineraries: z.boolean()
});

const defaultPreferences: z.infer<typeof preferencesSchema> = {
  defaultTravelDays: 5,
  defaultBudgetCNY: 5000,
  voiceAssistEnabled: true,
  autoPersistItineraries: false
};

export async function GET() {
  try {
    const supabase = createSupabaseServerClient({ access: "write" });
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser();

    if (userError) {
      console.warn("[Settings] Failed to verify user for preferences GET", userError);
    }

    if (!user) {
      return NextResponse.json({
        error: "UNAUTHORIZED",
        message: "请先登录后再读取配置"
      }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("user_preferences")
      .select("preferences")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      console.error("[Settings] Failed to fetch user preferences", error);
      return NextResponse.json({
        error: "SUPABASE_ERROR",
        message: "获取偏好设置失败"
      }, { status: 500 });
    }

    const merged = { ...defaultPreferences, ...(data?.preferences ?? {}) };
    const parseResult = preferencesSchema.safeParse(merged);
    const preferences = parseResult.success ? parseResult.data : defaultPreferences;

    return NextResponse.json({ preferences });
  } catch (error) {
    console.error("[Settings] Unhandled preferences GET error", error);
    return NextResponse.json({
      error: "INTERNAL_ERROR",
      message: "获取偏好设置失败"
    }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const supabase = createSupabaseServerClient({ access: "write" });
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser();

    if (userError) {
      console.warn("[Settings] Failed to verify user for preferences PUT", userError);
    }

    if (!user) {
      return NextResponse.json({
        error: "UNAUTHORIZED",
        message: "请先登录后再保存配置"
      }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const parsed = preferencesSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({
        error: "INVALID_REQUEST",
        details: parsed.error.flatten()
      }, { status: 400 });
    }

    const { error } = await supabase
      .from("user_preferences")
      .upsert({
        user_id: user.id,
        preferences: parsed.data
      }, { onConflict: "user_id" });

    if (error) {
      console.error("[Settings] Failed to upsert user preferences", error);
      return NextResponse.json({
        error: "SUPABASE_ERROR",
        message: "保存偏好设置失败"
      }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[Settings] Unhandled preferences PUT error", error);
    return NextResponse.json({
      error: "INTERNAL_ERROR",
      message: "保存偏好设置失败"
    }, { status: 500 });
  }
}
