import { getDb, startSyncIfNeeded, waitForSync } from "@/lib/db/db";
import { supabase } from "@/lib/db/supabase";
import { getCurrentUser } from "@/lib/utils/auth";
import {
  sendNewLoanAdminEmails,
  sendLoanStatusEmail,
  sendLoanPendingEmail,
} from "@/lib/services/email";
import { sendTelegramMessage } from "@/lib/services/telegram";
import { autoApproveTechLoan } from "@/lib/services/techLoanAutoApproval";
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
const DEFAULT_LOAN_PAGE_SIZE = 100;
const MAX_LOAN_PAGE_SIZE = 100;
const RELATED_SEARCH_MIN_LENGTH = 2;
const AUTO_APPROVE_ADMIN_NOTE = "Auto-approved by global setting";
const TECH_LOAN_SELECT = `
      id,
      user_id,
      loan_type,
      purpose,
  remarks,
      department,
      location,
      start_date,
      end_date,
      status,
      admin_notes,
      created_at,
      updated_at,
      users (display_name, username, telegram_handle, profile_emoji)
    `;

function sanitizeSearchTerm(value) {
  return value.replace(/[,%()]/g, " ").trim();
}

async function getMatchingTechLoanIds(searchTerm) {
  if (!searchTerm) return [];

  const { data, error } = await supabase
    .from("loan_items")
    .select("loan_request_id")
    .ilike("item_name", `%${searchTerm}%`);

  if (error) throw new Error(error.message || "Failed to search loan items");

  return [...new Set((data || []).map((item) => item.loan_request_id))];
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

function canSearchRequesterFields(view, user) {
  return view === "all" || view === "active" || user.role === "admin";
}

async function getRelatedSearchMatches({ searchTerm, includeUsers }) {
  if (!searchTerm || searchTerm.length < RELATED_SEARCH_MIN_LENGTH) {
    return { matchingLoanIds: [], matchingUserIds: [] };
  }

  const [matchingLoanIds, matchingUserIds] = await Promise.all([
    getMatchingTechLoanIds(searchTerm),
    includeUsers ? getMatchingUserIds(searchTerm) : Promise.resolve([]),
  ]);

  return { matchingLoanIds, matchingUserIds };
}

function parseBoundedInt(value, fallback, max) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, max);
}

// GET: fetch loan requests
export async function GET(request) {
  const user = await getCurrentUser();

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "";
  const view = searchParams.get("view") || "my";
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

  // Lightweight count path — admin only, no payload
  if (countOnly && user?.role === "admin") {
    let cq = supabase
      .from("loan_requests")
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
    const [{ count: techCount }, { count: guestCount }] = await Promise.all([
      cq,
      isOverdueFilter
        ? Promise.resolve({ count: 0 })
        : (() => {
            let gq = supabase
              .from("guest_borrow_requests")
              .select("id", { count: "exact", head: true });
            if (status) gq = gq.eq("status", status);
            return gq;
          })(),
    ]);
    return NextResponse.json({ count: (techCount || 0) + (guestCount || 0) });
  }

  // Build query for loan_requests
  let query = supabase
    .from("loan_requests")
    .select(TECH_LOAN_SELECT, search ? undefined : { count: "exact" })
    .order("created_at", { ascending: false });

  if (view === "active") {
    // Team calendar visibility should only expose approved loans.
    query = query.eq("status", "approved");
  } else if (view !== "all" || user?.role !== "admin") {
    query = query.eq("user_id", user.id);
  }
  if (isOverdueFilter) {
    const today = getTodaySingaporeDateString();
    query = query
      .eq("status", "approved")
      .eq("loan_type", "temporary")
      .not("end_date", "is", null)
      .lt("end_date", today);
  } else if (status && view !== "active") {
    query = query.eq("status", status);
  }
  if (dateFrom) query = query.gte("start_date", dateFrom);
  if (dateTo) query = query.lte("start_date", dateTo);

  if (sanitizedSearch) {
    const includeUserSearch = user
      ? canSearchRequesterFields(view, user)
      : false;
    const { matchingLoanIds, matchingUserIds } = await getRelatedSearchMatches({
      searchTerm: sanitizedSearch,
      includeUsers: includeUserSearch,
    });

    const orPattern = `*${sanitizedSearch}*`;
    const searchClauses = [
      `purpose.ilike.${orPattern}`,
      `remarks.ilike.${orPattern}`,
      `department.ilike.${orPattern}`,
      `location.ilike.${orPattern}`,
    ];

    if (matchingLoanIds.length > 0) {
      searchClauses.push(`id.in.(${matchingLoanIds.join(",")})`);
    }

    if (includeUserSearch && matchingUserIds.length > 0) {
      searchClauses.push(`user_id.in.(${matchingUserIds.join(",")})`);
    }

    query = query.or(searchClauses.join(","));
  }

  query = query.range(offset, offset + limit - 1);

  const { data: loanRows, count } = await query;
  let loans = (loanRows || []).map((lr) => ({
    ...lr,
    requester_name: lr.users?.display_name || null,
    requester_username: lr.users?.username || null,
    requester_telegram: lr.users?.telegram_handle || null,
    requester_profile_emoji: lr.users?.profile_emoji || null,
    users: undefined,
    items: [],
  }));

  // Batch-load items for all loans
  if (loans.length > 0) {
    const loanIds = loans.map((l) => l.id);
    const { data: allItems } = await supabase
      .from("loan_items")
      .select("id, loan_request_id, item_id, sheet_row, item_name, quantity")
      .in("loan_request_id", loanIds);

    const itemsByLoan = new Map();
    for (const item of allItems || []) {
      if (!itemsByLoan.has(item.loan_request_id))
        itemsByLoan.set(item.loan_request_id, []);
      // Expose item_name as "item" to match the original shape the frontend expects
      itemsByLoan
        .get(item.loan_request_id)
        .push({ ...item, item: item.item_name });
    }
    for (const loan of loans) {
      loan.items = itemsByLoan.get(loan.id) || [];
    }
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
          items: (r.items || [])
            .filter((i) => i.source === "tech" || !i.source) // Default to tech for legacy
            .map((i) => ({
              id: null,
              loan_request_id: `g_${r.id}`,
              item_id: i.item_id || null,
              sheet_row: i.sheet_row || null,
              item: i.item_name || "Unknown Item",
              quantity: i.quantity || 1,
            })),
        }))
        .filter((l) => l.items.length > 0);

      loans = [...loans, ...guestLoans];
      loans.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
  }

  return NextResponse.json(
    {
      loans,
      pagination: {
        page,
        limit,
        total: count || 0,
        hasMore: offset + loans.length < (count || 0),
      },
    },
    {
      headers: {
        "Cache-Control": "private, s-maxage=5, stale-while-revalidate=15",
      },
    },
  );
}

// POST: create a new loan request
export async function POST(request) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  startSyncIfNeeded();

  try {
    const {
      loan_type,
      purpose,
      remarks,
      department,
      start_date,
      end_date,
      location,
      items,
    } = await request.json();

    if (!items || items.length === 0) {
      return NextResponse.json({ error: "No items selected" }, { status: 400 });
    }
    if (items.length > 50) {
      return NextResponse.json(
        { error: "Too many items in a single request" },
        { status: 400 },
      );
    }
    if (!["temporary", "permanent"].includes(loan_type)) {
      return NextResponse.json({ error: "Invalid loan type" }, { status: 400 });
    }
    for (const item of items) {
      if (
        !item.quantity ||
        item.quantity < 1 ||
        !Number.isInteger(item.quantity)
      ) {
        return NextResponse.json(
          { error: "Each item must have a quantity of at least 1" },
          { status: 400 },
        );
      }
      if (item.quantity > 100) {
        return NextResponse.json(
          { error: "Quantity cannot exceed 100 per item" },
          { status: 400 },
        );
      }
    }
    if (!purpose || !purpose.trim()) {
      return NextResponse.json(
        { error: "Purpose is required" },
        { status: 400 },
      );
    }
    if (loan_type === "permanent" && !["admin", "tech"].includes(user.role)) {
      return NextResponse.json(
        { error: "Only Tech team members can request permanent loans" },
        { status: 403 },
      );
    }
    if (!start_date) {
      return NextResponse.json(
        { error: "Start date is required" },
        { status: 400 },
      );
    }
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(start_date) || isNaN(Date.parse(start_date))) {
      return NextResponse.json(
        { error: "Invalid start date format" },
        { status: 400 },
      );
    }
    if (loan_type === "temporary" && !end_date) {
      return NextResponse.json(
        { error: "End date is required for temporary loans" },
        { status: 400 },
      );
    }
    if (
      end_date &&
      (!dateRegex.test(end_date) || isNaN(Date.parse(end_date)))
    ) {
      return NextResponse.json(
        { error: "Invalid end date format" },
        { status: 400 },
      );
    }
    if (end_date && start_date && end_date < start_date) {
      return NextResponse.json(
        { error: "End date cannot be before start date" },
        { status: 400 },
      );
    }

    // Inventory validation + name lookup from SQLite
    await waitForSync();
    const db = getDb();

    const itemIds = items.map((i) => i.item_id);
    const placeholders = itemIds.map(() => "?").join(",");
    const storageRows = db
      .prepare(`SELECT * FROM storage_items WHERE id IN (${placeholders})`)
      .all(...itemIds);
    const storageMap = new Map(storageRows.map((r) => [r.id, r]));

    const resolvedItems = [];
    for (const item of items) {
      const storageItem = storageMap.get(item.item_id);
      if (!storageItem) {
        return NextResponse.json(
          { error: `Item not found: ${item.item_id}` },
          { status: 400 },
        );
      }
      if (storageItem.current < item.quantity) {
        return NextResponse.json(
          {
            error: `Not enough stock for "${storageItem.item}". Available: ${storageItem.current}, Requested: ${item.quantity}`,
          },
          { status: 400 },
        );
      }
      resolvedItems.push({
        item_id: item.item_id,
        sheet_row: storageItem.sheet_row,
        item_name: storageItem.item,
        quantity: item.quantity,
      });
    }

    const trimmedPurpose = purpose.trim();
    const trimmedRemarks = remarks?.trim() || null;
    const autoApproveLoans = await isAppSettingEnabled("auto_approve_loans");

    // Create loan request in Supabase
    const { data: newLoan, error: loanError } = await supabase
      .from("loan_requests")
      .insert({
        user_id: user.id,
        loan_type,
        purpose: trimmedPurpose,
        remarks: trimmedRemarks,
        department: department || "",
        location: location || "",
        start_date,
        end_date: end_date || null,
        status: autoApproveLoans ? "approved" : "pending",
        admin_notes: autoApproveLoans ? AUTO_APPROVE_ADMIN_NOTE : "",
      })
      .select("id")
      .single();

    if (loanError) throw loanError;
    const loanId = newLoan.id;

    // Insert loan items with item_name + sheet_row for stability
    const { error: itemsError } = await supabase.from("loan_items").insert(
      resolvedItems.map((i) => ({
        loan_request_id: loanId,
        item_id: i.item_id,
        sheet_row: i.sheet_row,
        item_name: i.item_name,
        quantity: i.quantity,
      })),
    );
    if (itemsError) {
      // Roll back the loan request if items failed to insert
      await supabase.from("loan_requests").delete().eq("id", loanId);
      throw itemsError;
    }

    if (autoApproveLoans) {
      try {
        await autoApproveTechLoan({
          db,
          loanId,
          loanType: loan_type,
          purpose: trimmedPurpose,
          department: department || "",
          location: location || "",
          resolvedItems,
        });
      } catch (autoApproveError) {
        await supabase.from("loan_requests").delete().eq("id", loanId);
        throw autoApproveError;
      }
    }

    try {
      const { data: userRecord } = await supabase
        .from("users")
        .select("email, display_name, mute_emails, mute_telegram")
        .eq("id", user.id)
        .single();

      const itemListStr = resolvedItems
        .map((i) => `${i.item_name} × ${i.quantity}`)
        .join(", ");
      const itemsForEmail = resolvedItems.map((i) => ({
        item: i.item_name,
        quantity: i.quantity,
      }));
      const remarksLine = trimmedRemarks ? `\nRemarks: ${trimmedRemarks}` : "";
      const requesterName = user.display_name || user.username || "A user";
      const periodLine = end_date
        ? `Period: ${start_date} to ${end_date}`
        : `Start Date: ${start_date}`;

      if (autoApproveLoans) {
        await supabase.from("activity_feed").insert({
          user_id: user.id,
          action: "auto_approve",
          description: `Loan #${loanId} was auto-approved by global setting`,
          link: "/loans",
        });

        await supabase.from("audit_log").insert({
          user_id: user.id,
          action: "auto_approve",
          target_type: "loan",
          target_id: loanId,
          details: `Auto-approved ${loan_type} loan at submission by global setting.`,
        });

        // In-app notification to user
        await supabase.from("notifications").insert({
          user_id: user.id,
          message: `Your ${loan_type} loan request #${loanId} has been auto-approved!`,
          link: "/loans",
        });

        if (userRecord?.email && !userRecord?.mute_emails) {
          sendLoanStatusEmail({
            to: userRecord.email,
            displayName:
              userRecord.display_name || user.display_name || user.username,
            loanId,
            status: "approved",
            adminNotes: AUTO_APPROVE_ADMIN_NOTE,
            items: itemsForEmail,
          }).catch(() => {});
        }

        if (!userRecord?.mute_telegram) {
          sendTelegramMessage(
            user.id,
            `✅ <b>We've Received Your Loan</b>\nHere are your loan details:\n\nLoan ID: #${loanId}\nType: ${loan_type}\nPurpose: ${trimmedPurpose}\nItems: ${itemListStr}\n${periodLine}${remarksLine ? `${remarksLine}` : ""}`,
          ).catch(() => {});
        }

        const { data: admins } = await supabase
          .from("users")
          .select("id, mute_telegram")
          .eq("role", "admin");

        if (admins?.length) {
          await supabase.from("notifications").insert(
            admins.map((admin) => ({
              user_id: admin.id,
              message: `${requesterName} submitted an auto-approved ${loan_type} loan request #${loanId}.`,
              link: "/admin",
            })),
          );

          for (const admin of admins) {
            if (!admin.mute_telegram) {
              sendTelegramMessage(
                admin.id,
                `✅ <b>Auto-Approved Loan Request</b>\n<b>${requesterName}</b> submitted an auto-approved <b>${loan_type}</b> loan.\n\nPurpose: ${trimmedPurpose}${remarksLine}\nItems: ${itemListStr}`,
              ).catch(() => {});
            }
          }
        }

      } else {
        // Notify admins
        const { data: admins } = await supabase
          .from("users")
          .select("id, email, display_name, mute_emails, mute_telegram")
          .eq("role", "admin");

        if (admins && admins.length > 0) {
          await supabase.from("notifications").insert(
            admins.map((admin) => ({
              user_id: admin.id,
              message: `New ${loan_type} loan request from ${user.display_name}`,
              link: "/admin",
            })),
          );
        }

        // In-app + Telegram to user confirming submission
        await supabase.from("notifications").insert({
          user_id: user.id,
          message: `Your ${loan_type} loan request #${loanId} has been submitted and is pending approval.`,
          link: "/loans",
        });

        if (!userRecord?.mute_telegram) {
          sendTelegramMessage(
            user.id,
            `📝 <b>Loan Request Received</b>\nYour ${loan_type} loan #${loanId} has been submitted and is pending approval.\n\nPurpose: ${trimmedPurpose}\nItems: ${itemListStr}`,
          ).catch(() => {});
        }

        if (userRecord?.email && !userRecord?.mute_emails) {
          sendLoanPendingEmail({
            to: userRecord.email,
            displayName: user.display_name || user.username,
            loanId,
            loanType: loan_type,
            purpose: trimmedPurpose,
            remarks: trimmedRemarks,
            items: itemsForEmail,
          }).catch(() => {});
        }

        const unmutedAdminsEmail = (admins || []).filter((a) => !a.mute_emails);
        if (unmutedAdminsEmail.length > 0) {
          sendNewLoanAdminEmails({
            admins: unmutedAdminsEmail,
            userName: user.display_name || user.username,
            loanId,
            loanType: loan_type,
            purpose: trimmedPurpose,
            remarks: trimmedRemarks,
            items: itemsForEmail,
          }).catch(() => {});
        }

        for (const admin of admins || []) {
          if (!admin.mute_telegram) {
            sendTelegramMessage(
              admin.id,
              `🔔 <b>New Loan Request</b>\n<b>${user.display_name || user.username}</b> requested a <b>${loan_type}</b> loan.\n\nPurpose: ${trimmedPurpose}${remarksLine}\nItems: ${itemListStr}`,
            ).catch(() => {});
          }
        }
      }
    } catch (notifErr) {
      console.error("Failed to send loan creation notifications:", notifErr);
    }

    return NextResponse.json({
      loan_id: loanId,
      auto_approved: autoApproveLoans,
      message: autoApproveLoans
        ? "Loan request auto-approved!"
        : "Loan request submitted!",
    });
  } catch (error) {
    console.error("Loan creation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
