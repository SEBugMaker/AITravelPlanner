"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionContextProvider } from "@supabase/auth-helpers-react";
import type { Session } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "../lib/supabaseBrowser";

interface ProvidersProps {
  children: ReactNode;
  initialSession: Session | null;
}

export function Providers({ children, initialSession }: ProvidersProps) {
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

  return (
    <SessionContextProvider supabaseClient={supabaseClient} initialSession={initialSession}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </SessionContextProvider>
  );
}
