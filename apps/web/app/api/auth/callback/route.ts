import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../lib/supabaseServer";

interface AuthCallbackPayload {
  event: string;
  session: unknown;
}

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient({ access: "write" });
  let payload: AuthCallbackPayload | null = null;

  try {
    payload = (await request.json()) as AuthCallbackPayload;
  } catch (error) {
    return NextResponse.json({ error: "INVALID_PAYLOAD" }, { status: 400 });
  }

  const event = payload?.event;

  if (!event) {
    return NextResponse.json({ error: "MISSING_EVENT" }, { status: 400 });
  }

  if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
    const session = payload.session;
    if (!session) {
      return NextResponse.json({ error: "MISSING_SESSION" }, { status: 400 });
    }

    const { error } = await supabase.auth.setSession(session as any);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  if (event === "SIGNED_OUT") {
    const { error } = await supabase.auth.signOut();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ status: "ok" });
}
