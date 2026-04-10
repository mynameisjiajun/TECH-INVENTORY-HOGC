import { supabase } from "@/lib/db/supabase";
import { getCurrentUser } from "@/lib/utils/auth";
import { sendLoanStatusEmail } from "@/lib/services/email";
import { sendTelegramMessage } from "@/lib/services/telegram";
import { isAppSettingEnabled } from "@/lib/utils/appSettings";
import { getTodaySingaporeDateString } from "@/lib/utils/date";
import { NextResponse } from "next/server";

const VALID_LOAN_VIEWS = new Set(["my", "all", "active"]);
const VALID_LOAN_STATUSES = new Set([
  "pending",
  "approved",
  "overdue",
  "rejected",
  "returned",
]);
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_LOAN_PAGE_SIZE = 200;
const MAX_LOAN_PAGE_SIZE = 200;
const AUTO_APPROVE_ADMIN_NOTE = "Auto-approved by global setting";
const LAPTOP_LOAN_SELECT =
  "id, user_id, loan_type, purpose, remarks, department, start_date, end_date, status, admin_notes, created_at, updated_at, users(display_name, username, telegram_handle)";
const LAPTOP_LOAN_SELECT_LEGACY =
  "id, user_id, loan_type, purpose, remarks, department, start_date, end_date, status, admin_notes, created_at, updated_at, users(display_name, username)";

function isMissingTelegramHandleColumn(error) {
  const message = error?.message || "";
  return (
    error?.code === "42703" ||
    message.includes("telegram_handle") ||
    message.includes("column")
  );
}

function sanitizeSearchTerm(value) {
  return value.replace(/[,%()]/g, " ").trim();
}

function parseBoundedInt(value, fallback, max) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, max);
}

async function getMatchingLaptopLoanIds(searchTerm) {
  if (!searchTerm) return [];

  const { data: laptops, error: laptopError } = await supabase
    .from("laptops")
    .select("id")
    .ilike("name", `%${searchTerm}%`);

  if (laptopError) {
    throw new Error(laptopError.message || "Failed to search laptops");
  }

  const laptopIds = [...new Set((laptops || []).map((entry) => entry.id))];
  if (laptopIds.length === 0) return [];

  const { data: items, error: itemError } = await supabase
    .from("laptop_loan_items")
    .select("loan_request_id")
    .in("laptop_id", laptopIds);

  if (itemError) {
    throw new Error(itemError.message || "Failed to search laptop loan items");
  }

  return [...new Set((items || []).map((item) => item.loan_request_id))];
}

async function getMatchingUserIds(searchTerm) {
  if (!searchTerm) return [];

  const orPattern = `*${searchTerm}*`;
  const { data, error } = await supabase
    .from("users")
    .select("id")
    .or(`display_name.ilike.${orPattern},username.ilike.${orPattern}`);

  if (error) throw new Error(error.message || "Failed to search users");

  return [...new Set((data || []).map((entry) => entry.id))];
}

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

  const { searchParams } = new URL(request.url);
  const view = searchParams.get("view") || "my";
  const status = searchParams.get("status") || "";
  const search = (searchParams.get("search") || "").trim().slice(0, 100);
  const dateFrom = searchParams.get("date_from") || "";
  const dateTo = searchParams.get("date_to") || "";
  const countOnly = searchParams.get("count_only") === "true";
  const page = parseBoundedInt(searchParams.get("page"), 1, 10_000);
  const limit = parseBoundedInt(
    searchParams.get("limit"),
    DEFAULT_LOAN_PAGE_SIZE,
    MAX_LOAN_PAGE_SIZE,
  );
  const offset = (page - 1) * limit;

  if (!VALID_LOAN_VIEWS.has(view)) {
    return NextResponse.json({ error: "Invalid view" }, { status: 400 });
  }

  if (!user && view !== "active") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (status && !VALID_LOAN_STATUSES.has(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const isOverdueFilter = status === "overdue";
  const sanitizedSearch = sanitizeSearchTerm(search);

  if (countOnly && user?.role === "admin") {
    let cq = supabase
      .from("laptop_loan_requests")
      .select("id", { count: "exact", head: true });
    if (isOverdueFilter) {
      const today = getTodaySingaporeDateString();
      cq = cq
        .eq("status", "approved")
        .eq("loan_type", "temporary")
        .not("end_date", "is", null)
        .lt("end_date", today);
    } else if (status) {
      cq = cq.eq("status", status);
    }
    const { count } = await cq;
    return NextResponse.json({ count: count || 0 });
  }

  // Pre-compute search clauses (async) before building the query so we can
  // reuse them if we need to retry with the legacy select string.
  let searchClauses = null;
  if (sanitizedSearch) {
    const [matchingLoanIds, matchingUserIds] = await Promise.all([
      getMatchingLaptopLoanIds(sanitizedSearch),
      user ? getMatchingUserIds(sanitizedSearch) : Promise.resolve([]),
    ]);
    const orPattern = `*${sanitizedSearch}*`;
    searchClauses = [
      `purpose.ilike.${orPattern}`,
      `remarks.ilike.${orPattern}`,
      `department.ilike.${orPattern}`,
    ];
    if (matchingLoanIds.length > 0)
      searchClauses.push(`id.in.(${matchingLoanIds.join(",")})`);
    if (user && (view === "all" || view === "active") && matchingUserIds.length > 0)
      searchClauses.push(`user_id.in.(${matchingUserIds.join(",")})`);
  }

  // Build a filtered query from a given select string (reused for legacy retry).
  const buildQuery = (selectStr) => {
    let q = supabase
      .from("laptop_loan_requests")
      .select(selectStr, { count: "exact" })
      .order("created_at", { ascending: false });

    if (view === "active") {
      q = q.eq("status", "approved");
    } else {
      if (view !== "all" || user.role !== "admin") q = q.eq("user_id", user.id);
      if (isOverdueFilter) {
        const today = getTodaySingaporeDateString();
        q = q
          .eq("status", "approved")
          .eq("loan_type", "temporary")
          .not("end_date", "is", null)
          .lt("end_date", today);
      } else if (status) {
        q = q.eq("status", status);
      }
    }

    if (dateFrom) q = q.gte("start_date", dateFrom);
    if (dateTo) q = q.lte("start_date", dateTo);
    if (searchClauses) q = q.or(searchClauses.join(","));

    return q.range(offset, offset + limit - 1);
  };

  let { data: loanRows, error, count } = await buildQuery(LAPTOP_LOAN_SELECT);

  // If telegram_handle column doesn't exist yet, retry with the legacy select.
  if (error && isMissingTelegramHandleColumn(error)) {
    const legacyResult = await buildQuery(LAPTOP_LOAN_SELECT_LEGACY);
    if (legacyResult.error)
      return NextResponse.json({ error: legacyResult.error.message }, { status: 500 });
    loanRows = legacyResult.data;
    count = legacyResult.count;
    error = null;
  }

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  let loans = (loanRows || []).map((lr) => ({
    ...lr,
    requester_name: lr.users?.display_name || null,
    requester_username: lr.users?.username || null,
    requester_telegram: lr.users?.telegram_handle || null,
    users: undefined,
    laptops: [],
    _source: "laptop",
  }));

  // Batch-load laptop items
  if (loans.length > 0) {
    const loanIds = loans.map((l) => l.id);
    const { data: items } = await supabase
      .from("laptop_loan_items")
      .select(
        "id, loan_request_id, laptop_id, laptops(id, name, screen_size, cpu)",
      )
      .in("loan_request_id", loanIds);

    const byLoan = new Map();
    for (const item of items || []) {
      if (!byLoan.has(item.loan_request_id))
        byLoan.set(item.loan_request_id, []);
      byLoan.get(item.loan_request_id).push(item);
    }
    for (const loan of loans) loan.laptops = byLoan.get(loan.id) || [];
  }

  if (view === "all" || view === "active") {
    let gq = supabase
      .from("guest_borrow_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(MAX_LOAN_PAGE_SIZE);

    if (view === "active") {
      gq = gq.eq("status", "approved");
    } else if (status) {
      if (isOverdueFilter) {
        const today = getTodaySingaporeDateString();
        gq = gq
          .eq("status", "approved")
          .eq("loan_type", "temporary")
          .lt("end_date", today);
      } else {
        gq = gq.eq("status", status);
      }
    }

    if (dateFrom) gq = gq.gte("start_date", dateFrom);
    if (dateTo) gq = gq.lte("start_date", dateTo);

    if (sanitizedSearch) {
      const orPattern = `*${sanitizedSearch}*`;
      gq = gq.or(
        `guest_name.ilike.${orPattern},telegram_handle.ilike.${orPattern},purpose.ilike.${orPattern},department.ilike.${orPattern}`,
      );
    }

    const { data: guestRows, error: guestError } = await gq;
    if (guestRows && guestRows.length > 0) {
      const guestLoans = guestRows
        .map((r) => ({
          id: `g_${r.id}`,
          user_id: null,
          loan_type: r.loan_type,
          purpose: r.purpose,
          remarks: r.remarks,
          department: r.department,
          location: "Guest Request",
          start_date: r.start_date,
          end_date: r.end_date,
          status: r.status,
          admin_notes: r.admin_notes,
          created_at: r.created_at,
          updated_at: r.updated_at,
          requester_name: r.guest_name,
          requester_username: null,
          requester_telegram: r.telegram_handle,
          _source: "laptop",
          laptops: (r.items || [])
            .filter((i) => i.source === "laptop")
            .map((i) => ({
              id: null,
              loan_request_id: `g_${r.id}`,
              laptop_id: i.laptop_id,
              laptops: {
                id: i.laptop_id,
                name: i.item_name || "Unknown Laptop",
                screen_size: "",
                cpu: "",
              },
            })),
        }))
        .filter((l) => l.laptops.length > 0);

      loans = [...loans, ...guestLoans];
      loans.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
  }

  return NextResponse.json({
    loans,
    pagination: {
      page,
      limit,
      total: count || 0,
      hasMore: offset + loans.length < (count || 0),
    },
  });
}

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { loan_groups, purpose, remarks, department } = await request.json();
  // loan_groups = [{ loan_type, start_date, end_date, laptop_ids: [] }]

  if (!Array.isArray(loan_groups) || loan_groups.length === 0)
    return NextResponse.json({ error: "No laptops selected" }, { status: 400 });
  if (!purpose?.trim())
    return NextResponse.json({ error: "Purpose is required" }, { status: 400 });

  const trimmedPurpose = purpose.trim();
  const trimmedRemarks = remarks?.trim() || null;
  const autoApproveLoans = await isAppSettingEnabled("auto_approve_loans");

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
  const permanentLaptopIdsToAssign = [];

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
        purpose: trimmedPurpose,
        remarks: trimmedRemarks,
        department: department?.trim() || null,
        status: autoApproveLoans ? "approved" : "pending",
        admin_notes: autoApproveLoans ? AUTO_APPROVE_ADMIN_NOTE : null,
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

    if (autoApproveLoans && loan_type === "permanent") {
      permanentLaptopIdsToAssign.push(...laptop_ids);
    }

    createdLoans.push(loan);
  }

  if (autoApproveLoans && permanentLaptopIdsToAssign.length > 0) {
    const { error: approvePermanentError } = await supabase
      .from("laptops")
      .update({
        is_perm_loaned: true,
        perm_loan_person: user.display_name || user.username || null,
        perm_loan_reason: trimmedPurpose,
      })
      .in("id", permanentLaptopIdsToAssign);

    if (approvePermanentError) {
      await supabase
        .from("laptop_loan_requests")
        .delete()
        .in(
          "id",
          createdLoans.map((loan) => loan.id),
        );
      return NextResponse.json(
        {
          error:
            approvePermanentError.message ||
            "Failed to assign permanent laptop state",
        },
        { status: 500 },
      );
    }
  }

  const laptopCount = allRequestedLaptopIds.length;
  const remarksLine = trimmedRemarks ? `\nRemarks: ${trimmedRemarks}` : "";

  if (autoApproveLoans) {
    await supabase.from("notifications").insert({
      user_id: user.id,
      message: `Your laptop loan request${createdLoans.length > 1 ? "s were" : " was"} auto-approved.`,
      link: "/loans",
    });

    await supabase.from("activity_feed").insert({
      user_id: user.id,
      action: "auto_approve",
      description: `Laptop loan request${createdLoans.length > 1 ? "s" : ""} auto-approved by global setting`,
      link: "/loans",
    });

    const { data: userRecord } = await supabase
      .from("users")
      .select("email, display_name, mute_emails, mute_telegram")
      .eq("id", user.id)
      .single();

    const itemsForEmail = allRequestedLaptopIds.map((laptopId) => ({
      item: laptopMap.get(String(laptopId))?.name || `Laptop ${laptopId}`,
      quantity: 1,
    }));

    if (userRecord?.email && !userRecord?.mute_emails) {
      sendLoanStatusEmail({
        to: userRecord.email,
        displayName: userRecord.display_name || user.display_name,
        loanId: createdLoans[0]?.id,
        status: "approved",
        adminNotes: AUTO_APPROVE_ADMIN_NOTE,
        items: itemsForEmail,
      }).catch(() => {});
    }

    if (!userRecord?.mute_telegram) {
      sendTelegramMessage(
        user.id,
        `✅ <b>Laptop Loan Auto-Approved</b>\nYour laptop request${createdLoans.length > 1 ? "s are" : " is"} approved and active now.${remarksLine}`,
      ).catch(() => {});
    }
  } else {
    // Notify admins
    const { data: admins } = await supabase
      .from("users")
      .select("id, mute_telegram")
      .eq("role", "admin");

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
            `💻 <b>New Laptop Loan Request</b>\n<b>${user.display_name}</b> requested ${laptopCount} laptop(s).\nPurpose: ${trimmedPurpose}${remarksLine}`,
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
  }

  return NextResponse.json({
    auto_approved: autoApproveLoans,
    message: autoApproveLoans
      ? "Laptop loan request auto-approved!"
      : "Laptop loan request submitted!",
    loans: createdLoans,
  });
}
