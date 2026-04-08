import { supabase } from "@/lib/db/supabase";
import { getCurrentUser } from "@/lib/utils/auth";
import { sendTelegramMessage } from "@/lib/services/telegram";
import { NextResponse } from "next/server";

const VALID_LOAN_VIEWS = new Set(["my", "all", "active"]);
const VALID_LOAN_STATUSES = new Set([
  "pending",
  "approved",
  "rejected",
  "returned",
]);
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function normalizeLaptopIds(laptopIds) {
  if (!Array.isArray(laptopIds) || laptopIds.length === 0) {
    return { error: "Each loan group must include at least one laptop" };
  }

  const normalizedIds = [];
  const seenIds = new Set();

  for (const laptopId of laptopIds) {
    if (laptopId === null || laptopId === undefined || laptopId === "") {
      return { error: "Invalid laptop selection" };
    }

    const normalizedKey = String(laptopId);
    if (seenIds.has(normalizedKey)) {
      return { error: "Duplicate laptops are not allowed in the same request" };
    }

    seenIds.add(normalizedKey);
    normalizedIds.push(laptopId);
  }

  return { laptopIds: normalizedIds };
}

export async function GET(request) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const view = searchParams.get("view") || "my";
  const status = searchParams.get("status") || "";
  const countOnly = searchParams.get("count_only") === "true";

  if (!VALID_LOAN_VIEWS.has(view)) {
    return NextResponse.json({ error: "Invalid view" }, { status: 400 });
  }

  if (status && !VALID_LOAN_STATUSES.has(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  if (countOnly && user.role === "admin") {
    let cq = supabase
      .from("laptop_loan_requests")
      .select("id", { count: "exact", head: true });
    if (status) cq = cq.eq("status", status);
    const { count } = await cq;
    return NextResponse.json({ count: count || 0 });
  }

  let query = supabase
    .from("laptop_loan_requests")
    .select("*, users(display_name, username)")
    .order("created_at", { ascending: false });

  if (view === "active") {
    // All approved + pending loans for calendar display (any authenticated user)
    query = query.in("status", ["approved", "pending"]);
  } else {
    if (view !== "all" || user.role !== "admin") {
      query = query.eq("user_id", user.id);
    }
    if (status) query = query.eq("status", status);
  }

  const { data: loanRows, error } = await query;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

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
      if (!byLoan.has(item.loan_request_id))
        byLoan.set(item.loan_request_id, []);
      byLoan.get(item.loan_request_id).push(item);
    }
    for (const loan of loans) loan.laptops = byLoan.get(loan.id) || [];
  }

  return NextResponse.json({ loans });
}

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { loan_groups, purpose, department } = await request.json();
  // loan_groups = [{ loan_type, start_date, end_date, laptop_ids: [] }]

  if (!Array.isArray(loan_groups) || loan_groups.length === 0)
    return NextResponse.json({ error: "No laptops selected" }, { status: 400 });
  if (!purpose?.trim())
    return NextResponse.json({ error: "Purpose is required" }, { status: 400 });

  const hasPermanent = loan_groups.some((g) => g.loan_type === "permanent");
  if (hasPermanent && !["admin", "tech"].includes(user.role)) {
    return NextResponse.json(
      { error: "Only Tech team members can request permanent loans" },
      { status: 403 },
    );
  }

  const allRequestedLaptopIds = [];
  const requestedLaptopIdKeys = new Set();
  const normalizedGroups = [];

  for (const group of loan_groups) {
    if (!group || typeof group !== "object") {
      return NextResponse.json(
        { error: "Invalid loan group" },
        { status: 400 },
      );
    }

    const { loan_type, start_date, end_date } = group;
    if (!["temporary", "permanent"].includes(loan_type)) {
      return NextResponse.json({ error: "Invalid loan type" }, { status: 400 });
    }
    if (
      !start_date ||
      !DATE_REGEX.test(start_date) ||
      Number.isNaN(Date.parse(start_date))
    ) {
      return NextResponse.json(
        { error: "Valid start date is required" },
        { status: 400 },
      );
    }
    if (loan_type === "temporary") {
      if (
        !end_date ||
        !DATE_REGEX.test(end_date) ||
        Number.isNaN(Date.parse(end_date))
      ) {
        return NextResponse.json(
          { error: "Valid end date required for temporary loans" },
          { status: 400 },
        );
      }
      if (end_date < start_date) {
        return NextResponse.json(
          { error: "End date cannot be before start date" },
          { status: 400 },
        );
      }
    } else if (end_date) {
      return NextResponse.json(
        { error: "Permanent loans cannot include an end date" },
        { status: 400 },
      );
    }

    const { laptopIds, error: laptopIdsError } = normalizeLaptopIds(
      group.laptop_ids,
    );
    if (laptopIdsError) {
      return NextResponse.json({ error: laptopIdsError }, { status: 400 });
    }

    for (const laptopId of laptopIds) {
      const normalizedKey = String(laptopId);
      if (requestedLaptopIdKeys.has(normalizedKey)) {
        return NextResponse.json(
          { error: "Each laptop can only be requested once per submission" },
          { status: 400 },
        );
      }

      requestedLaptopIdKeys.add(normalizedKey);
      allRequestedLaptopIds.push(laptopId);
    }

    normalizedGroups.push({
      loan_type,
      start_date,
      end_date: loan_type === "temporary" ? end_date : null,
      laptop_ids: laptopIds,
    });
  }

  const { data: laptops } = await supabase
    .from("laptops")
    .select("id, name, is_perm_loaned")
    .in("id", allRequestedLaptopIds);

  const laptopMap = new Map(
    (laptops || []).map((laptop) => [String(laptop.id), laptop]),
  );

  if (laptopMap.size !== allRequestedLaptopIds.length) {
    return NextResponse.json(
      { error: "One or more selected laptops no longer exist" },
      { status: 400 },
    );
  }

  for (const laptop of laptopMap.values()) {
    if (laptop.is_perm_loaned) {
      return NextResponse.json(
        { error: `Laptop "${laptop.name}" is permanently loaned` },
        { status: 400 },
      );
    }
  }

  // Pre-fetch all active loans once for conflict checking (avoids per-group queries)
  const { data: activeLoans } = await supabase
    .from("laptop_loan_requests")
    .select("id, start_date, end_date, laptop_loan_items(laptop_id)")
    .in("status", ["approved", "pending"]);

  const createdLoans = [];

  for (const group of normalizedGroups) {
    const { loan_type, start_date, end_date, laptop_ids } = group;

    // Check for date conflicts using pre-fetched active loans
    if (loan_type === "temporary") {
      for (const conflict of activeLoans || []) {
        const cEnd = conflict.end_date || "9999-12-31";
        if (conflict.start_date <= end_date && cEnd >= start_date) {
          for (const item of conflict.laptop_loan_items || []) {
            if (laptop_ids.includes(item.laptop_id)) {
              const laptop = laptopMap.get(String(item.laptop_id));
              return NextResponse.json(
                {
                  error: `Laptop "${laptop?.name || item.laptop_id}" is already booked for those dates`,
                },
                { status: 409 },
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
        department: department?.trim() || null,
        status: "pending",
      })
      .select()
      .single();

    if (loanErr)
      return NextResponse.json({ error: loanErr.message }, { status: 500 });

    const { error: itemsErr } = await supabase
      .from("laptop_loan_items")
      .insert(
        laptop_ids.map((lid) => ({ loan_request_id: loan.id, laptop_id: lid })),
      );
    if (itemsErr) {
      await supabase.from("laptop_loan_requests").delete().eq("id", loan.id);
      return NextResponse.json({ error: itemsErr.message }, { status: 500 });
    }

    createdLoans.push(loan);
  }

  // Notify admins
  const { data: admins } = await supabase
    .from("users")
    .select("id, mute_telegram")
    .eq("role", "admin");
  const laptopCount = allRequestedLaptopIds.length;

  if (admins?.length) {
    await supabase.from("notifications").insert(
      admins.map((a) => ({
        user_id: a.id,
        message: `${user.display_name} submitted ${createdLoans.length} laptop loan request(s) for ${laptopCount} laptop(s).`,
        link: "/admin",
      })),
    );
    for (const admin of admins) {
      if (!admin.mute_telegram) {
        sendTelegramMessage(
          admin.id,
          `💻 <b>New Laptop Loan Request</b>\n<b>${user.display_name}</b> requested ${laptopCount} laptop(s).\nPurpose: ${purpose.trim()}`,
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

  return NextResponse.json({
    message: "Laptop loan request submitted!",
    loans: createdLoans,
  });
}
