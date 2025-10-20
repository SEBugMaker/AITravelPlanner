"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionContextProvider } from "@supabase/auth-helpers-react";
import type { Session } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "../lib/supabaseBrowser";
import { useRouter } from "next/navigation";

interface ProvidersProps {
  children: ReactNode;
  initialSession: Session | null;
}

export function Providers({ children, initialSession }: ProvidersProps) {
  const router = useRouter();
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
            staleTime: 1000 * 60 * 5
          }
        }
      })
  );

  const [supabaseClient] = useState(() => createSupabaseBrowserClient());

  useEffect(() => {
    const {
      data: { subscription }
    } = supabaseClient.auth.onAuthStateChange(async (event, session) => {
      if (event === "INITIAL_SESSION") {
        return;
      }
      try {
        await fetch("/api/auth/callback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event, session })
        });
      } catch (error) {
        console.warn("[Providers] Failed to sync auth state", error);
      } finally {
        router.refresh();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [supabaseClient, router]);

  return (
    <SessionContextProvider supabaseClient={supabaseClient} initialSession={initialSession}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </SessionContextProvider>
  );
}
