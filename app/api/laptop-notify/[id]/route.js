import { supabase } from "@/lib/db/supabase";
import { getCurrentUser } from "@/lib/utils/auth";
import { NextResponse } from "next/server";

// POST /api/laptop-notify/[id] — toggle notify-me for a laptop
export async function POST(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // Check if already subscribed
  const { data: existing } = await supabase
    .from("laptop_notifications")
    .select("id")
    .eq("user_id", user.id)
    .eq("laptop_id", id)
    .maybeSingle();

  if (existing) {
    await supabase.from("laptop_notifications").delete().eq("id", existing.id);
    return NextResponse.json({ subscribed: false, message: "Notification removed" });
  }

  await supabase.from("laptop_notifications").insert({ user_id: user.id, laptop_id: id });
  return NextResponse.json({ subscribed: true, message: "You'll be notified when this laptop is available" });
}
