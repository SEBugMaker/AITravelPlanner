import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdminClient } from "../../../../lib/supabaseAdmin";

const signupSchema = z.object({
  email: z.string().email("邮箱格式不正确"),
  password: z.string().min(6, "密码至少 6 位")
});

export async function POST(request: Request): Promise<Response> {
  try {
    const payload = await request.json();
    const { email, password } = signupSchema.parse(payload);

    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { error: "Supabase 配置缺失，暂无法注册" },
        { status: 500 }
      );
    }

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });

    if (error) {
      const message = error.message ?? "注册失败";
      const status = /already registered/i.test(message) ? 409 : 400;
      return NextResponse.json({ error: message }, { status });
    }

    return NextResponse.json({ userId: data.user?.id ?? null }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "参数校验失败" }, { status: 422 });
    }

    console.error("Unhandled signup error", error);
    return NextResponse.json({ error: "注册请求处理失败" }, { status: 500 });
  }
}
