import { supabase } from "@/lib/db/supabase";
import { NextResponse } from "next/server";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim();

  if (!q || q.length < 2) {
    return NextResponse.json({ loans: [] });
  }

  const orPattern = `*${q}*`;
  
  // Search only approved guest requests matching guest_name or telegram_handle
  const { data: activeGuestRequests, error } = await supabase
    .from("guest_borrow_requests")
    .select("*")
    .eq("status", "approved")
    .or(`guest_name.ilike.${orPattern},telegram_handle.ilike.${orPattern}`)
    .order("start_date", { ascending: true })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Format similarly to normal loans
  const formattedGuestLoans = (activeGuestRequests || []).flatMap((r) => {
    const techItems = (r.items || [])
      .filter((i) => i.source === "tech" || !i.source)
      .map((i) => ({
        id: null,
        item: i.item_name || "Unknown Item",
        quantity: i.quantity || 1,
      }));
    const laptopItems = (r.items || [])
      .filter((i) => i.source === "laptop")
      .map((i) => ({
        id: null,
        item: i.item_name || "Unknown Laptop",
        quantity: 1,
      }));

    const result = [];

    if (techItems.length > 0) {
      result.push({
        id: `g_${r.id}`,
        db_id: r.id,
        user_id: null,
        loan_type: r.loan_type,
        purpose: r.purpose,
        remarks: r.remarks,
        department: r.department,
        start_date: r.start_date,
        end_date: r.end_date,
        status: r.status,
        created_at: r.created_at,
        requester_name: r.guest_name,
        requester_telegram: r.telegram_handle,
        _loanKind: "tech",
        items: techItems,
      });
    }

    if (laptopItems.length > 0) {
      result.push({
        id: `g_${r.id}`,
        db_id: r.id,
        user_id: null,
        loan_type: r.loan_type,
        purpose: r.purpose,
        remarks: r.remarks,
        department: r.department,
        start_date: r.start_date,
        end_date: r.end_date,
        status: r.status,
        created_at: r.created_at,
        requester_name: r.guest_name,
        requester_telegram: r.telegram_handle,
        _loanKind: "laptop",
        items: laptopItems,
      });
    }

    return result;
  });

  return NextResponse.json({ loans: formattedGuestLoans });
}
