"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "../../lib/supabaseBrowser";

const initialState = {
  email: "",
  password: "",
  mode: "signIn" as "signIn" | "signUp"
};

export function AuthForm() {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { email, password, mode } = state;

      if (mode === "signUp") {
        const response = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password })
        });

        if (!response.ok) {
          const result = (await response.json().catch(() => null)) as { error?: string } | null;
          const message = result?.error ?? "注册失败，请稍后再试";
          throw new Error(message);
        }
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;

      router.push("/planner");
      router.refresh();
    } catch (err) {
  setError((err as Error).message ?? "登录失败，请稍后再试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-3">
        <label className="block text-sm font-medium text-slate-700" htmlFor="email">
          邮箱
        </label>
        <input
          id="email"
          type="email"
          required
          value={state.email}
          onChange={(event) => setState((prev) => ({ ...prev, email: event.target.value }))}
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 shadow-inner focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
          placeholder="you@example.com"
        />
      </div>

      <div className="space-y-3">
        <label className="block text-sm font-medium text-slate-700" htmlFor="password">
          密码
        </label>
        <input
          id="password"
          type="password"
          required
          value={state.password}
          onChange={(event) => setState((prev) => ({ ...prev, password: event.target.value }))}
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 shadow-inner focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
          placeholder="至少 6 位"
        />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">
          {state.mode === "signIn" ? "还没有账号？" : "已经注册过？"}
        </span>
        <button
          type="button"
          onClick={() =>
            setState((prev) => ({
              ...prev,
              mode: prev.mode === "signIn" ? "signUp" : "signIn"
            }))
          }
          className="text-xs font-medium text-slate-600 underline"
        >
          {state.mode === "signIn" ? "切换到注册" : "切换到登录"}
        </button>
      </div>

      {error ? <p className="text-xs text-rose-500">{error}</p> : null}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-2xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-900/10 transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "提交中..." : state.mode === "signIn" ? "登录" : "注册并登录"}
      </button>
    </form>
  );
}
