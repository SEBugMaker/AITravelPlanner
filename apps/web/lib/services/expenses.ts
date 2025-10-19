import { getSupabaseAdminClient } from "../supabaseAdmin";

export interface ExpenseRecordInput {
  itineraryId: string;
  amount: number;
  currency?: string;
  category: string;
  note?: string;
  occurredAt?: string;
  userId?: string | null;
}

export async function recordExpense(input: ExpenseRecordInput) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    console.warn("Supabase admin client unavailable, skip expense recording");
    return { ok: false, reason: "SUPABASE_NOT_CONFIGURED" } as const;
  }

  const { occurredAt, ...rest } = input;
  const payload = {
    ...rest,
    currency: input.currency ?? "CNY",
    occurred_at: occurredAt ?? new Date().toISOString(),
    created_at: new Date().toISOString()
  };

  const { error } = await supabase.from("expense_records").insert(payload);
  if (error) {
    console.error("Failed to insert expense", error);
    return { ok: false, reason: "SUPABASE_ERROR", error } as const;
  }

  return { ok: true } as const;
}
