import { supabase } from "@/lib/db/supabase";
import { getCurrentUser } from "@/lib/utils/auth";
import { NextResponse } from "next/server";

export async function GET(request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "50") || 50, 1), 200);
  const offset = Math.max(parseInt(searchParams.get("offset") || "0") || 0, 0);

  const { data: logs, count: total } = await supabase
    .from("audit_log")
    .select(`
      *,
      users (display_name, username)
    `, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  // Flatten user fields to match original shape
  const flatLogs = (logs || []).map((log) => ({
    ...log,
    user_name: log.users?.display_name || null,
    username: log.users?.username || null,
    users: undefined,
  }));

  return NextResponse.json({ logs: flatLogs, total: total || 0 });
}
