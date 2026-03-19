import { supabase } from "@/lib/db/supabase";
import { getCurrentUser } from "@/lib/utils/auth";
import { NextResponse } from "next/server";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [{ data: notifications }, { count: unreadCount }] = await Promise.all([
    supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("read", false),
  ]);

  return NextResponse.json({ notifications: notifications || [], unreadCount: unreadCount || 0 });
}

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { action, notification_id } = await request.json();

  if (action === "read") {
    if (!notification_id || !Number.isInteger(Number(notification_id))) {
      return NextResponse.json(
        { error: "Valid notification_id is required" },
        { status: 400 },
      );
    }
    await supabase
      .from("notifications")
      .update({ read: true })
      .eq("id", notification_id)
      .eq("user_id", user.id);
  } else if (action === "read_all") {
    await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", user.id);
  }

  return NextResponse.json({ ok: true });
}
