import { supabase } from "@/lib/db/supabase";
import { getCurrentUser } from "@/lib/utils/auth";
import { NextResponse } from "next/server";

export async function GET(request) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== "admin") {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      Math.max(parseInt(searchParams.get("limit") || "50") || 50, 1),
      200,
    );
    const offset = Math.max(
      parseInt(searchParams.get("offset") || "0") || 0,
      0,
    );

    const { data: logs, count: total, error: logsError } = await supabase
      .from("audit_log")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (logsError) {
      throw new Error(logsError.message || "Failed to load audit logs");
    }

    const userIds = [...new Set((logs || []).map((log) => log.user_id).filter(Boolean))];
    let usersById = new Map();

    if (userIds.length > 0) {
      const { data: users, error: usersError } = await supabase
        .from("users")
        .select("id, display_name, username")
        .in("id", userIds);

      if (usersError) {
        throw new Error(usersError.message || "Failed to load audit users");
      }

      usersById = new Map((users || []).map((entry) => [entry.id, entry]));
    }

    const flatLogs = (logs || []).map((log) => {
      const actor = usersById.get(log.user_id);
      return {
        ...log,
        user_name: actor?.display_name || null,
        username: actor?.username || null,
      };
    });

    return NextResponse.json({ logs: flatLogs, total: total || 0 });
  } catch (error) {
    console.error("Audit GET error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to load audit logs" },
      { status: 500 },
    );
  }
}
