import type { Metadata } from "next";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { Inter } from "next/font/google";
import { Providers } from "./providers";
import { AppHeader } from "../components/layout/app-header";
import { createSupabaseServerClient } from "../lib/supabaseServer";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AI Travel Planner",
  description: "AI-assisted itinerary planning with voice interaction and real-time budgeting"
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const supabase = createSupabaseServerClient();
  const [sessionResult, userResult] = await Promise.all([
    supabase.auth.getSession(),
    supabase.auth.getUser()
  ]);

  const session = sessionResult.data.session ?? null;
  const verifiedUser = userResult.data.user ?? null;

  const sanitizedSession: Session | null = session && verifiedUser
    ? ({
        ...session,
        user: verifiedUser
      } as Session)
    : session;

  return (
    <html lang="zh-CN">
      <body className={`${inter.className} min-h-screen bg-gradient-to-b from-slate-100 to-slate-200`}>
        <Providers initialSession={sanitizedSession}>
          <AppHeader />
          <main className="min-h-screen pt-4">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
