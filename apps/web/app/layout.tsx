import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { AppHeader } from "../components/layout/app-header";
import { createSupabaseServerClient } from "../lib/supabaseServer";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AI Travel Planner",
  description: "AI-assisted itinerary planning with voice interaction and real-time budgeting"
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { session }
  } = await supabase.auth.getSession();

  return (
    <html lang="zh-CN">
      <body className={`${inter.className} min-h-screen bg-gradient-to-b from-slate-100 to-slate-200`}>
        <Providers initialSession={session ?? null}>
          <AppHeader />
          <main className="min-h-screen pt-24">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
