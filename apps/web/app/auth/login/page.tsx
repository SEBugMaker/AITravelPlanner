import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AuthForm } from "../../../components/auth/auth-form";
import { createSupabaseServerClient } from "../../../lib/supabaseServer";

export const metadata: Metadata = {
  title: "登录 | AI Travel Planner",
  description: "登录后即可将行程保存到云端"
};

export default async function LoginPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error) {
    console.warn("[Auth] Failed to verify user session", error);
  }

  if (user) {
    redirect("/planner");
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6 py-12">
      <div className="w-full max-w-md space-y-8 rounded-3xl border border-slate-200 bg-white/90 p-8 shadow-sm">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold text-slate-900">登录 / 注册</h1>
          <p className="text-sm text-slate-500">使用邮箱密码登录即可体验云端行程保存与同步</p>
        </div>
        <AuthForm />
        <p className="text-center text-xs text-slate-400">
          返回<Link href="/" className="ml-1 text-slate-600 underline">首页</Link>
        </p>
      </div>
    </div>
  );
}
