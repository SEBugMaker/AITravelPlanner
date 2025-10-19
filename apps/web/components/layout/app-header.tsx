"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSessionContext } from "@supabase/auth-helpers-react";

export function AppHeader() {
  const router = useRouter();
  const { session, supabaseClient } = useSessionContext();
  const [loading, setLoading] = useState(false);
  const [authSession, setAuthSession] = useState(session ?? null);

  useEffect(() => {
    setAuthSession(session ?? null);
  }, [session]);

  useEffect(() => {
    const { data: listener } = supabaseClient.auth.onAuthStateChange((_, newSession) => {
      setAuthSession(newSession ?? null);
    });

    return () => {
      listener?.subscription.unsubscribe();
    };
  }, [supabaseClient]);

  const isAuthenticated = Boolean(authSession);

  const handleSignOut = async () => {
    setLoading(true);
    try {
      await supabaseClient.auth.signOut({ scope: "local" });
      await supabaseClient.auth.signOut({ scope: "global" });
      setAuthSession(null);
      router.push("/auth/login");
    } finally {
      setLoading(false);
    }
  };

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-base font-semibold text-slate-900">
          AI Travel Planner
        </Link>
        <nav className="flex items-center gap-6 text-sm text-slate-600">
          <Link href="/" className="transition hover:text-slate-900">
            首页
          </Link>
          <Link href="/planner" className="transition hover:text-slate-900">
            智能规划
          </Link>
          <Link href="/#features" className="transition hover:text-slate-900">
            功能亮点
          </Link>
        </nav>
        <div className="flex items-center gap-4">
          {isAuthenticated ? (
            <button
              type="button"
              disabled={loading}
              onClick={handleSignOut}
              className="rounded-full border border-slate-200 px-4 py-2 text-sm text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "退出中..." : "退出登录"}
            </button>
          ) : (
            <Link
              href="/auth/login"
              className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              登录 / 注册
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
