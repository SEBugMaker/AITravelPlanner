import { NextResponse } from "next/server";
import { z } from "zod";
import { recordExpense } from "../../../lib/services/expenses";
import { createSupabaseServerClient } from "../../../lib/supabaseServer";
import { getSupabaseAdminClient } from "../../../lib/supabaseAdmin";

const requestSchema = z.object({
  itineraryId: z.string().min(1),
  amount: z.number().min(0),
  currency: z.string().optional(),
  category: z.string().min(1),
  note: z.string().max(280).optional(),
  occurredAt: z.string().optional()
});

const querySchema = z.object({
  itineraryId: z.string().min(1, "itineraryId is required")
});

const deleteSchema = z.object({
  id: z.string().min(1)
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

    const supabase = createSupabaseServerClient();
    const {
      data: { session }
    } = await supabase.auth.getSession();

    if (!session) {
      return NextResponse.json({
        error: "UNAUTHORIZED",
        message: "请先登录后再记录消费"
      }, { status: 401 });
    }

    const { itineraryId, ...payload } = parsed.data;
    const adminClient = getSupabaseAdminClient();

    if (!adminClient) {
      return NextResponse.json({
        error: "SUPABASE_NOT_CONFIGURED",
        message: "Supabase Service Role 未配置，无法记录消费"
      }, { status: 500 });
    }

    const { data: itineraryRow, error: itineraryError } = await adminClient
      .from("itineraries")
      .select("id, user_id")
      .eq("id", itineraryId)
      .maybeSingle();

    if (itineraryError) {
      console.error("Failed to validate itinerary ownership", itineraryError);
      return NextResponse.json({
        error: "SUPABASE_ERROR",
        message: "无法验证行程所有权"
      }, { status: 500 });
    }

    if (!itineraryRow || itineraryRow.user_id !== session.user.id) {
      return NextResponse.json({
        error: "FORBIDDEN",
        message: "当前账号无权写入该行程消费"
      }, { status: 403 });
    }

    const result = await recordExpense({
      itineraryId,
      ...payload,
      userId: session.user.id
    });

    if (!result.ok) {
      return NextResponse.json({
        error: result.reason,
        message: "记录消费失败"
      }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Expense recording failed", error);
    return NextResponse.json({
      error: "INTERNAL_ERROR",
      message: "系统错误"
    }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const itineraryId = searchParams.get("itineraryId") ?? "";
    const parsed = querySchema.safeParse({ itineraryId });

    if (!parsed.success) {
      return NextResponse.json({
        error: "INVALID_REQUEST",
        details: parsed.error.flatten()
      }, { status: 400 });
    }

    const supabase = createSupabaseServerClient();
    const {
      data: { session }
    } = await supabase.auth.getSession();

    if (!session) {
      return NextResponse.json({
        error: "UNAUTHORIZED",
        message: "请先登录后查看消费记录"
      }, { status: 401 });
    }

    const adminClient = getSupabaseAdminClient();
    if (!adminClient) {
      return NextResponse.json({
        error: "SUPABASE_NOT_CONFIGURED",
        message: "Supabase Service Role 未配置，无法查询消费记录"
      }, { status: 500 });
    }

    const { data: itineraryRow, error: itineraryError } = await adminClient
      .from("itineraries")
      .select("id, user_id")
      .eq("id", itineraryId)
      .maybeSingle();

    if (itineraryError) {
      console.error("Failed to validate itinerary ownership", itineraryError);
      return NextResponse.json({
        error: "SUPABASE_ERROR",
        message: "无法验证行程所有权"
      }, { status: 500 });
    }

    if (!itineraryRow || itineraryRow.user_id !== session.user.id) {
      return NextResponse.json({
        error: "FORBIDDEN",
        message: "当前账号无权查看该行程消费"
      }, { status: 403 });
    }

    const { data, error } = await adminClient
      .from("expense_records")
      .select("id, amount, currency, category, note, occurred_at, created_at")
      .eq("itineraryId", itineraryId)
      .eq("userId", session.user.id)
      .order("occurred_at", { ascending: false });

    if (error) {
      console.error("Failed to fetch expenses", error);
      return NextResponse.json({
        error: "SUPABASE_ERROR",
        message: "获取消费记录失败"
      }, { status: 500 });
    }

    const expenses = (data ?? []).map((item) => ({
      id: item.id,
      amount: Number(item.amount ?? 0),
      currency: item.currency ?? "CNY",
      category: item.category ?? "其他",
      note: item.note ?? null,
      occurredAt: item.occurred_at ?? item.created_at ?? new Date().toISOString(),
      createdAt: item.created_at ?? item.occurred_at ?? new Date().toISOString()
    }));

    const total = expenses.reduce((sum, expense) => sum + (Number.isFinite(expense.amount) ? expense.amount : 0), 0);
    const categoryMap = new Map<string, number>();
    expenses.forEach((expense) => {
      const current = categoryMap.get(expense.category) ?? 0;
      if (Number.isFinite(expense.amount)) {
        categoryMap.set(expense.category, current + expense.amount);
      }
    });

    const byCategory = Array.from(categoryMap.entries())
      .map(([category, value]) => ({ category, total: value }))
      .sort((a, b) => b.total - a.total);

    const currency = expenses[0]?.currency ?? "CNY";

    return NextResponse.json({
      expenses,
      summary: {
        total,
        currency,
        byCategory
      }
    });
  } catch (error) {
    console.error("Expense fetch failed", error);
    return NextResponse.json({
      error: "INTERNAL_ERROR",
      message: "获取消费记录失败"
    }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const payload = await request.json().catch(() => null);
    const parsed = deleteSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json({
        error: "INVALID_REQUEST",
        details: parsed.error.flatten()
      }, { status: 400 });
    }

    const supabase = createSupabaseServerClient();
    const {
      data: { session }
    } = await supabase.auth.getSession();

    if (!session) {
      return NextResponse.json({
        error: "UNAUTHORIZED",
        message: "请先登录后再删除消费记录"
      }, { status: 401 });
    }

    const adminClient = getSupabaseAdminClient();
    if (!adminClient) {
      return NextResponse.json({
        error: "SUPABASE_NOT_CONFIGURED",
        message: "Supabase Service Role 未配置，无法删除消费记录"
      }, { status: 500 });
    }

    const { data: expenseRecord, error: fetchError } = await adminClient
      .from("expense_records")
      .select("id, userId, itineraryId")
      .eq("id", parsed.data.id)
      .maybeSingle();

    if (fetchError) {
      console.error("Failed to fetch expense for deletion", fetchError);
      return NextResponse.json({
        error: "SUPABASE_ERROR",
        message: "无法校验消费记录归属"
      }, { status: 500 });
    }

    if (!expenseRecord || expenseRecord.userId !== session.user.id) {
      return NextResponse.json({
        error: "FORBIDDEN",
        message: "无权删除该消费记录"
      }, { status: 403 });
    }

    const { error: deleteError } = await adminClient
      .from("expense_records")
      .delete()
      .eq("id", parsed.data.id)
      .limit(1);

    if (deleteError) {
      console.error("Failed to delete expense", deleteError);
      return NextResponse.json({
        error: "SUPABASE_ERROR",
        message: "删除消费记录失败"
      }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Expense delete failed", error);
    return NextResponse.json({
      error: "INTERNAL_ERROR",
      message: "删除消费记录失败"
    }, { status: 500 });
  }
}
