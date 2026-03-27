import { supabase } from "@/lib/db/supabase";
import { getCurrentUser } from "@/lib/utils/auth";
import { sendTelegramMessage } from "@/lib/services/telegram";
import { NextResponse } from "next/server";

export async function GET(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const view = searchParams.get("view") || "my";
  const status = searchParams.get("status") || "";

  let query = supabase
    .from("laptop_loan_requests")
    .select("*, users(display_name, username)")
    .order("created_at", { ascending: false });

  if (view !== "all" || user.role !== "admin") {
    query = query.eq("user_id", user.id);
  }
  if (status) query = query.eq("status", status);

  const { data: loanRows, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const loans = (loanRows || []).map((lr) => ({
    ...lr,
    requester_name: lr.users?.display_name || null,
    requester_username: lr.users?.username || null,
    users: undefined,
    laptops: [],
    _source: "laptop",
  }));

  // Batch-load laptop items
  if (loans.length > 0) {
    const loanIds = loans.map((l) => l.id);
    const { data: items } = await supabase
      .from("laptop_loan_items")
      .select("*, laptops(id, name, screen_size, cpu)")
      .in("loan_request_id", loanIds);

    const byLoan = new Map();
    for (const item of items || []) {
      if (!byLoan.has(item.loan_request_id)) byLoan.set(item.loan_request_id, []);
      byLoan.get(item.loan_request_id).push(item);
    }
    for (const loan of loans) loan.laptops = byLoan.get(loan.id) || [];
  }

  return NextResponse.json({ loans });
}

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { loan_groups, purpose } = await request.json();
  // loan_groups = [{ loan_type, start_date, end_date, laptop_ids: [] }]

  if (!loan_groups?.length) return NextResponse.json({ error: "No laptops selected" }, { status: 400 });
  if (!purpose?.trim()) return NextResponse.json({ error: "Purpose is required" }, { status: 400 });

  const createdLoans = [];

  for (const group of loan_groups) {
    const { loan_type, start_date, end_date, laptop_ids } = group;

    if (!start_date) return NextResponse.json({ error: "Start date is required" }, { status: 400 });
    if (loan_type === "temporary" && !end_date) return NextResponse.json({ error: "End date required for temporary loans" }, { status: 400 });
    if (!laptop_ids?.length) continue;

    // Verify laptops exist and are not perm-loaned
    const { data: laptops } = await supabase
      .from("laptops")
      .select("id, name, is_perm_loaned")
      .in("id", laptop_ids);

    for (const laptop of laptops || []) {
      if (laptop.is_perm_loaned) {
        return NextResponse.json({ error: `Laptop "${laptop.name}" is permanently loaned` }, { status: 400 });
      }
    }

    // Check for date conflicts (only for temp loans)
    if (loan_type === "temporary") {
      const { data: conflicts } = await supabase
        .from("laptop_loan_requests")
        .select("id, start_date, end_date, laptop_loan_items(laptop_id)")
        .in("status", ["approved", "pending"]);

      for (const conflict of conflicts || []) {
        const cEnd = conflict.end_date || "9999-12-31";
        if (conflict.start_date <= end_date && cEnd >= start_date) {
          for (const item of conflict.laptop_loan_items || []) {
            if (laptop_ids.includes(item.laptop_id)) {
              const laptop = laptops?.find((l) => l.id === item.laptop_id);
              return NextResponse.json(
                { error: `Laptop "${laptop?.name || item.laptop_id}" is already booked for those dates` },
                { status: 409 }
              );
            }
          }
        }
      }
    }

    // Create the loan request
    const { data: loan, error: loanErr } = await supabase
      .from("laptop_loan_requests")
      .insert({
        user_id: user.id,
        loan_type,
        start_date,
        end_date: loan_type === "temporary" ? end_date : null,
        purpose: purpose.trim(),
        status: "pending",
      })
      .select()
      .single();

    if (loanErr) return NextResponse.json({ error: loanErr.message }, { status: 500 });

    await supabase.from("laptop_loan_items").insert(
      laptop_ids.map((lid) => ({ loan_request_id: loan.id, laptop_id: lid }))
    );

    createdLoans.push(loan);
  }

  // Notify admins
  const { data: admins } = await supabase.from("users").select("id, mute_telegram").eq("role", "admin");
  const laptopNames = loan_groups.flatMap((g) => g.laptop_ids).length;

  if (admins?.length) {
    await supabase.from("notifications").insert(
      admins.map((a) => ({
        user_id: a.id,
        message: `${user.display_name} submitted ${createdLoans.length} laptop loan request(s) for ${laptopNames} laptop(s).`,
        link: "/admin",
      }))
    );
    for (const admin of admins) {
      if (!admin.mute_telegram) {
        sendTelegramMessage(
          admin.id,
          `💻 <b>New Laptop Loan Request</b>\n<b>${user.display_name}</b> requested ${laptopNames} laptop(s).\nPurpose: ${purpose.trim()}`
        ).catch(() => {});
      }
    }
  }

  // Notify user
  await supabase.from("notifications").insert({
    user_id: user.id,
    message: `Your laptop loan request has been submitted and is pending approval.`,
    link: "/loans",
  });

  return NextResponse.json({ message: "Laptop loan request submitted!", loans: createdLoans });
}
