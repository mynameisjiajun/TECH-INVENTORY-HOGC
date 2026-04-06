import { supabase } from "@/lib/db/supabase";
import { getCurrentUser } from "@/lib/utils/auth";
import { NextResponse } from "next/server";

export async function GET(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get("start_date");
  const endDate = searchParams.get("end_date");

  const today = new Date().toISOString().split("T")[0];

  const [{ data: tiers }, { data: laptops }, { data: activeLoans }, { data: notifs }] = await Promise.all([
    supabase.from("laptop_tiers").select("*").order("display_order"),
    supabase.from("laptops").select("*").order("name"),
    supabase.from("laptop_loan_requests")
      .select("id, start_date, end_date, loan_type, users(display_name, username), laptop_loan_items(laptop_id)")
      .in("status", ["approved", "pending"]),
    supabase.from("laptop_notifications").select("laptop_id").eq("user_id", user.id),
  ]);

  // Build maps: which laptops are unavailable for the requested dates, and their return dates
  const unavailableIds = new Set();
  const returnDateMap = new Map(); // laptop_id -> earliest return date
  const borrowerMap = new Map(); // laptop_id -> borrower display name

  for (const loan of activeLoans || []) {
    // For overdue approved loans, treat effective end as "today" so they remain
    // blocked until admin marks them returned — prevents booking a laptop that
    // hasn't actually come back yet.
    const effectiveEnd = loan.end_date && loan.end_date < today ? today : (loan.end_date || "9999-12-31");

    for (const item of loan.laptop_loan_items || []) {
      const lid = item.laptop_id;

      // Check date overlap if dates provided
      if (startDate && endDate) {
        if (loan.start_date <= endDate && effectiveEnd >= startDate) {
          unavailableIds.add(lid);
        }
      }

      // Track nearest return date for temp loans currently active
      if (loan.loan_type === "temporary" && loan.end_date) {
        const displayDate = loan.end_date >= today ? loan.end_date : today;
        if (!returnDateMap.has(lid) || displayDate < returnDateMap.get(lid)) {
          returnDateMap.set(lid, loan.end_date);
          const borrower = loan.users?.display_name || loan.users?.username || null;
          if (borrower) borrowerMap.set(lid, borrower);
        }
      }
    }
  }

  const notifiedIds = new Set((notifs || []).map((n) => n.laptop_id));

  // Annotate each laptop
  const annotated = (laptops || []).map((laptop) => {
    const isPermLoaned = laptop.is_perm_loaned;
    const isBlocked = !isPermLoaned && (startDate && endDate) && unavailableIds.has(laptop.id);
    // temp_loaned: has an active or overdue loan (includes overdue via returnDateMap)
    const hasTempLoan = !isPermLoaned && returnDateMap.has(laptop.id);

    let availability = "available";
    if (isPermLoaned) availability = "perm_loaned";
    else if (isBlocked) availability = "blocked";
    else if (hasTempLoan && !(startDate && endDate)) availability = "temp_loaned";

    return {
      ...laptop,
      // Strip sensitive fields from regular users; tech team and admins can see specs
      ram: ["admin", "tech"].includes(user.role) ? laptop.ram : undefined,
      storage: ["admin", "tech"].includes(user.role) ? laptop.storage : undefined,
      availability,
      return_date: returnDateMap.get(laptop.id) || null,
      borrower_name: borrowerMap.get(laptop.id) || null,
      notify_me: notifiedIds.has(laptop.id),
    };
  });

  // Group by tier
  const tiersWithLaptops = (tiers || []).map((tier) => ({
    ...tier,
    laptops: annotated.filter((l) => l.tier_id === tier.id),
  }));

  // Returning soon = laptops that are blocked (for selected dates) with a return date
  // If no dates selected, show all currently temp-loaned laptops
  const returningSoon = annotated
    .filter((l) => l.return_date && (startDate ? l.availability === "blocked" : l.availability === "temp_loaned"))
    .sort((a, b) => (a.return_date > b.return_date ? 1 : -1))
    .slice(0, 10);

  return NextResponse.json({ tiers: tiersWithLaptops, returningSoon });
}

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name, tier_id, screen_size, cpu, ram, storage, condition } = await request.json();
  if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const { data, error } = await supabase
    .from("laptops")
    .insert({ name: name.trim(), tier_id: tier_id || null, screen_size, cpu, ram, storage, condition: condition || "Good" })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ laptop: data });
}
