import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { level = "info", message = "", data = null } = await request.json();
    const payload = { level, message, data };

    if (level === "error") {
      console.error("[PlannerMap][remote]", payload);
    } else if (level === "warn") {
      console.warn("[PlannerMap][remote]", payload);
    } else {
      console.log("[PlannerMap][remote]", payload);
    }

    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error("[PlannerMap][remote] Failed to log", error);
    return NextResponse.json({ status: "error" }, { status: 500 });
  }
}
