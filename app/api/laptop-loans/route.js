import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import { getCurrentUser } from "@/lib/utils/auth";
import { sendTelegramMessage } from "@/lib/services/telegram";
import { fmtDatetime } from "@/lib/laptops";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let query = supabase
    .from("laptop_loans")
    .select("*")
    .order("created_at", { ascending: false });

  if (user.role !== "admin") {
    query = query.eq("user_id", user.id);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { laptopId, laptopName, ministry, startDatetime, endDatetime, reason } = body;

  if (!laptopId || !startDatetime || !endDatetime || !reason) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const startDate = startDatetime.slice(0, 10);
  const endDate = endDatetime.slice(0, 10);
  const durationMs = new Date(endDatetime) - new Date(startDatetime);
  const durationHrs = Math.round(durationMs / 3600000);
  const duration = durationHrs === 1 ? "1 hour" : `${durationHrs} hours`;

  const { data, error } = await supabase
    .from("laptop_loans")
    .insert({
      user_id: user.id,
      laptop_id: laptopId,
      laptop_name: laptopName || laptopId,
      borrower_name: user.display_name || user.username,
      ministry: ministry || null,
      start_date: startDate,
      end_date: endDate,
      start_datetime: startDatetime,
      end_datetime: endDatetime,
      duration,
      reason,
      status: "active",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const startFmt = fmtDatetime(startDatetime);
  const endFmt = fmtDatetime(endDatetime);

  await sendTelegramMessage(
    user.id,
    `✅ <b>Laptop Loan Confirmed</b>\n\n<b>Laptop:</b> ${laptopId} (${laptopName})\n<b>From:</b> ${startFmt}\n<b>To:</b> ${endFmt}\n<b>Duration:</b> ${duration}\n<b>Reason:</b> ${reason}\n\nPlease return the laptop with its cable and charger. Thank you!`
  );

  return NextResponse.json(data, { status: 201 });
}
