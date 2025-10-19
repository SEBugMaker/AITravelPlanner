import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

type SupabaseServerClientAccess = "read" | "write";

interface SupabaseServerClientOptions {
  access?: SupabaseServerClientAccess;
}

export function createSupabaseServerClient(options?: SupabaseServerClientOptions) {
  const access: SupabaseServerClientAccess = options?.access ?? "read";
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          if (access !== "write") {
            return;
          }
          try {
            cookieStore.set({ name, value, ...options });
          } catch (error) {
            console.warn("Supabase cookie set skipped", error);
          }
        },
        remove(name: string, options: CookieOptions) {
          if (access !== "write") {
            return;
          }
          try {
            cookieStore.delete({ name, ...options });
          } catch (error) {
            console.warn("Supabase cookie remove skipped", error);
          }
        }
      }
    }
  );
}
