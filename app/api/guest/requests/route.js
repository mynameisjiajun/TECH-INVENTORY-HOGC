import { getDb, startSyncIfNeeded, waitForSync } from "@/lib/db/db";
import { supabase } from "@/lib/db/supabase";
import { sendTelegramMessage } from "@/lib/services/telegram";
import { autoApproveTechLoan } from "@/lib/services/techLoanAutoApproval";
import { isAppSettingEnabled } from "@/lib/utils/appSettings";
import { checkRateLimit } from "@/lib/utils/rateLimit";
import { getRequestClientIdentifier } from "@/lib/utils/request";
import { normalizeTelegramHandle } from "@/lib/utils/telegramHandle";
import {
  insertRowsBestEffort,
  mutationError,
  withWarnings,
} from "@/lib/utils/mutationSafety";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function parseDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "") &&
    !Number.isNaN(Date.parse(value))
    ? value
    : null;
}

function normalizeTechItems(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    item_id: Number(item.item_id),
    quantity: Number(item.quantity),
  }));
}

function normalizeLaptopIds(laptopIds) {
  if (!Array.isArray(laptopIds) || laptopIds.length === 0) {
    return { error: "Each laptop group must include at least one laptop" };
  }

  const ids = [];
  const seenIds = new Set();

  for (const laptopId of laptopIds) {
    const normalizedId = Number(laptopId);
    if (!Number.isInteger(normalizedId)) {
      return { error: "Invalid laptop selection" };
    }
    if (seenIds.has(normalizedId)) {
      return { error: "Duplicate laptops are not allowed in the same request" };
    }

    seenIds.add(normalizedId);
    ids.push(normalizedId);
  }

  return { laptopIds: ids };
}

async function resolveTechItems(db, items) {
  if (items.length === 0) return [];

  const requestedIds = [...new Set(items.map((item) => item.item_id))];
  const placeholders = requestedIds.map(() => "?").join(",");
  const storageItems = db
    .prepare(
      `SELECT id, sheet_row, item, type, brand, model, current, location FROM storage_items WHERE id IN (${placeholders})`,
    )
    .all(...requestedIds);
  const storageMap = new Map(storageItems.map((item) => [item.id, item]));

  return items.map((requestedItem) => {
    const storageItem = storageMap.get(requestedItem.item_id);
    if (!storageItem) {
      throw new Error(`Item not found: ${requestedItem.item_id}`);
    }
    if (
      !Number.isInteger(requestedItem.quantity) ||
      requestedItem.quantity < 1 ||
      storageItem.current < requestedItem.quantity
    ) {
      throw new Error(
        `Not enough stock for \"${storageItem.item}\". Available: ${storageItem.current}, requested: ${requestedItem.quantity}`,
      );
    }

    return {
      item_id: storageItem.id,
      sheet_row: storageItem.sheet_row,
      item_name: storageItem.item,
      type: storageItem.type,
      brand: storageItem.brand,
      model: storageItem.model,
      location: storageItem.location,
      quantity: requestedItem.quantity,
    };
  });
}

async function resolveLaptopGroups(loanGroups) {
  if (!Array.isArray(loanGroups) || loanGroups.length === 0) return [];

  const allRequestedLaptopIds = [];
  const requestedLaptopIdKeys = new Set();
  const normalizedGroups = [];

  for (const group of loanGroups) {
    const startDate = parseDate(group?.start_date);
    const endDate = parseDate(group?.end_date);
    if (!startDate || !endDate || endDate < startDate) {
      throw new Error(
        "Every laptop group must include a valid temporary date range",
      );
    }

    const normalizedIds = normalizeLaptopIds(group?.laptop_ids);
    if (normalizedIds.error) {
      throw new Error(normalizedIds.error);
    }

    for (const laptopId of normalizedIds.laptopIds) {
      if (requestedLaptopIdKeys.has(laptopId)) {
        throw new Error(
          "Each laptop can only be requested once per submission",
        );
      }
      requestedLaptopIdKeys.add(laptopId);
      allRequestedLaptopIds.push(laptopId);
    }

    normalizedGroups.push({
      loan_type: "temporary",
      start_date: startDate,
      end_date: endDate,
      laptop_ids: normalizedIds.laptopIds,
    });
  }

  const { data: laptops } = await supabase
    .from("laptops")
    .select("id, name, is_perm_loaned")
    .in("id", allRequestedLaptopIds);

  const laptopMap = new Map(
    (laptops || []).map((laptop) => [laptop.id, laptop]),
  );
  if (laptopMap.size !== allRequestedLaptopIds.length) {
    throw new Error("One or more selected laptops no longer exist");
  }

  for (const laptop of laptopMap.values()) {
    if (laptop.is_perm_loaned) {
      throw new Error(`Laptop \"${laptop.name}\" is permanently loaned`);
    }
  }

  const { data: activeLoans } = await supabase
    .from("laptop_loan_requests")
    .select("id, start_date, end_date, laptop_loan_items(laptop_id)")
    .in("status", ["approved", "pending"]);

  for (const group of normalizedGroups) {
    for (const conflict of activeLoans || []) {
      const conflictEnd = conflict.end_date || "9999-12-31";
      if (
        conflict.start_date <= group.end_date &&
        conflictEnd >= group.start_date
      ) {
        for (const item of conflict.laptop_loan_items || []) {
          if (group.laptop_ids.includes(item.laptop_id)) {
            const laptop = laptopMap.get(item.laptop_id);
            throw new Error(
              `Laptop \"${laptop?.name || item.laptop_id}\" is already booked for those dates`,
            );
          }
        }
      }
    }
  }

  return normalizedGroups.map((group) => ({
    ...group,
    laptops: group.laptop_ids.map((laptopId) => ({
      laptop_id: laptopId,
      name: laptopMap.get(laptopId)?.name || `Laptop ${laptopId}`,
    })),
  }));
}

async function findMatchedUser(normalizedTelegram) {
  if (!normalizedTelegram) return null;

  const { data } = await supabase
    .from("users")
    .select("id, username, display_name, telegram_handle")
    .ilike("telegram_handle", normalizedTelegram)
    .maybeSingle();

  return data || null;
}

async function createMatchedTechLoan({
  db,
  matchedUser,
  purpose,
  remarks,
  department,
  startDate,
  endDate,
  resolvedTechItems,
  autoApprove,
}) {
  if (!resolvedTechItems.length) return null;

  if (!startDate || !endDate || endDate < startDate) {
    throw new Error("Tech items require a valid temporary date range");
  }

  const { data: newLoan, error: loanError } = await supabase
    .from("loan_requests")
    .insert({
      user_id: matchedUser.id,
      loan_type: "temporary",
      purpose,
      remarks,
      department,
      location: "",
      start_date: startDate,
      end_date: endDate,
      status: autoApprove ? "approved" : "pending",
      admin_notes: autoApprove ? "Auto-approved by global setting" : null,
    })
    .select("id")
    .single();

  if (loanError) throw loanError;

  const { error: itemsError } = await supabase.from("loan_items").insert(
    resolvedTechItems.map((item) => ({
      loan_request_id: newLoan.id,
      item_id: item.item_id,
      sheet_row: item.sheet_row,
      item_name: item.item_name,
      quantity: item.quantity,
    })),
  );

  if (itemsError) {
    await supabase.from("loan_requests").delete().eq("id", newLoan.id);
    throw itemsError;
  }

  if (autoApprove) {
    try {
      await autoApproveTechLoan({
        db,
        loanId: newLoan.id,
        loanType: "temporary",
        purpose,
        department,
        location: "",
        resolvedItems: resolvedTechItems,
      });
    } catch (error) {
      await supabase.from("loan_requests").delete().eq("id", newLoan.id);
      throw error;
    }
  }

  return newLoan.id;
}

async function createMatchedLaptopLoans({
  matchedUser,
  purpose,
  remarks,
  department,
  resolvedLaptopGroups,
  autoApprove,
}) {
  const createdIds = [];

  for (const group of resolvedLaptopGroups) {
    const { data: loan, error: loanErr } = await supabase
      .from("laptop_loan_requests")
      .insert({
        user_id: matchedUser.id,
        loan_type: "temporary",
        start_date: group.start_date,
        end_date: group.end_date,
        purpose,
        remarks,
        department,
        status: autoApprove ? "approved" : "pending",
        admin_notes: autoApprove ? "Auto-approved by global setting" : null,
      })
      .select("id")
      .single();

    if (loanErr) throw loanErr;

    const { error: itemsErr } = await supabase.from("laptop_loan_items").insert(
      group.laptop_ids.map((laptopId) => ({
        loan_request_id: loan.id,
        laptop_id: laptopId,
      })),
    );

    if (itemsErr) {
      await supabase.from("laptop_loan_requests").delete().eq("id", loan.id);
      throw itemsErr;
    }

    createdIds.push(loan.id);
  }

  return createdIds;
}

async function notifyAdmins({
  admins,
  guestName,
  purpose,
  remarks,
  summaryLines,
  warnings,
}) {
  await insertRowsBestEffort({
    client: supabase,
    table: "notifications",
    entries: (admins || []).map((admin) => ({
      user_id: admin.id,
      message: `New guest checkout from ${guestName} is pending review.`,
      link: "/admin",
    })),
    warnings,
    context: "guest request admin",
  });

  for (const admin of admins || []) {
    sendTelegramMessage(
      admin.id,
      `🧾 <b>Guest Checkout</b>\n<b>${guestName}</b> submitted a request.\nPurpose: ${purpose}${remarks ? `\nRemarks: ${remarks}` : ""}\n${summaryLines.join("\n")}`,
    ).catch(() => {});
  }
}

export async function POST(request) {
  const warnings = [];

  try {
    const clientId = getRequestClientIdentifier(request);
    const rateLimit = await checkRateLimit(`guest:borrow:${clientId}`);
    if (rateLimit.limited) {
      return NextResponse.json(
        {
          error: `Too many guest requests. Please try again in ${Math.ceil(rateLimit.retryAfterSeconds / 60)} minutes.`,
        },
        { status: 429 },
      );
    }

    const {
      guest_name,
      telegram_handle,
      department,
      email,
      purpose,
      remarks,
      start_date,
      end_date,
      tech_items,
      laptop_groups,
      items,
    } = await request.json();

    if (!guest_name?.trim()) {
      return NextResponse.json(
        { error: "Full name is required" },
        { status: 400 },
      );
    }
    const normalizedTelegram = normalizeTelegramHandle(telegram_handle);
    if (!purpose?.trim()) {
      return NextResponse.json(
        { error: "Purpose is required" },
        { status: 400 },
      );
    }
    if (
      !Array.isArray(tech_items || items || []) &&
      !Array.isArray(laptop_groups || [])
    ) {
      return NextResponse.json(
        { error: "Invalid guest checkout payload" },
        { status: 400 },
      );
    }

    const normalizedTechItems = normalizeTechItems(tech_items || items || []);
    const normalizedStartDate = parseDate(start_date);
    const normalizedEndDate = parseDate(end_date);
    const trimmedPurpose = purpose.trim();
    const trimmedRemarks = remarks?.trim() || null;

    if (
      normalizedTechItems.length === 0 &&
      (!Array.isArray(laptop_groups) || laptop_groups.length === 0)
    ) {
      return NextResponse.json(
        { error: "Please select at least one item" },
        { status: 400 },
      );
    }
    if (normalizedTechItems.length > 20) {
      return NextResponse.json(
        { error: "Too many items in one guest request" },
        { status: 400 },
      );
    }

    if (
      normalizedTechItems.length > 0 &&
      (!normalizedStartDate ||
        !normalizedEndDate ||
        normalizedEndDate < normalizedStartDate)
    ) {
      return NextResponse.json(
        { error: "Tech items require valid start and end dates" },
        { status: 400 },
      );
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 },
      );
    }

    for (const item of normalizedTechItems) {
      if (
        !Number.isInteger(item.item_id) ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1
      ) {
        return NextResponse.json(
          { error: "Each guest item must have a valid quantity" },
          { status: 400 },
        );
      }
    }

    startSyncIfNeeded();
    await waitForSync();
    const db = getDb();

    const resolvedTechItems = await resolveTechItems(db, normalizedTechItems);
    const resolvedLaptopGroups = await resolveLaptopGroups(laptop_groups || []);
    const matchedUser = await findMatchedUser(normalizedTelegram);
    const autoApproveLoans = await isAppSettingEnabled("auto_approve_loans");
    const autoApproveGuestRequests = await isAppSettingEnabled(
      "auto_approve_guest_requests",
    );

    const { data: admins, error: adminsError } = await supabase
      .from("users")
      .select("id")
      .eq("role", "admin");

    if (adminsError) {
      warnings.push(
        mutationError("Failed to load admin recipients", adminsError),
      );
    }

    const summaryLines = [
      ...(resolvedTechItems.length > 0
        ? [
            `Tech: ${resolvedTechItems
              .map((item) => `${item.item_name} × ${item.quantity}`)
              .join(", ")}`,
          ]
        : []),
      ...(resolvedLaptopGroups.length > 0
        ? resolvedLaptopGroups.map(
            (group) =>
              `Laptops (${group.start_date} → ${group.end_date}): ${group.laptops
                .map((laptop) => laptop.name)
                .join(", ")}`,
          )
        : []),
    ];

    if (matchedUser) {
      const techLoanId = await createMatchedTechLoan({
        db,
        matchedUser,
        purpose: trimmedPurpose,
        remarks: trimmedRemarks,
        department: department?.trim() || "",
        startDate: normalizedStartDate,
        endDate: normalizedEndDate,
        resolvedTechItems,
        autoApprove: autoApproveLoans,
      });
      const laptopLoanIds = await createMatchedLaptopLoans({
        matchedUser,
        purpose: trimmedPurpose,
        remarks: trimmedRemarks,
        department: department?.trim() || null,
        resolvedLaptopGroups,
        autoApprove: autoApproveLoans,
      });

      if (techLoanId || laptopLoanIds.length > 0) {
        await insertRowsBestEffort({
          client: supabase,
          table: "notifications",
          entries: [
            {
              user_id: matchedUser.id,
              message: autoApproveLoans
                ? "A guest checkout matched your Telegram handle and was auto-approved in My Loans."
                : "A guest checkout matched your Telegram handle and is now in My Loans.",
              link: "/loans",
            },
          ],
          warnings,
          context: "matched guest request user",
        });
      }

      if (!autoApproveLoans) {
        await notifyAdmins({
          admins,
          guestName: guest_name.trim(),
          purpose: trimmedPurpose,
          remarks: trimmedRemarks,
          summaryLines,
          warnings,
        });
      }

      return NextResponse.json(
        withWarnings(
          {
            linked_user_id: matchedUser.id,
            tech_loan_id: techLoanId,
            laptop_loan_ids: laptopLoanIds,
            auto_approved: autoApproveLoans,
            message: autoApproveLoans
              ? "Request linked to your existing account and auto-approved."
              : "Request submitted and linked to your existing account.",
          },
          warnings,
        ),
      );
    }

    const serializedItems = [
      ...resolvedTechItems.map((item) => ({
        source: "tech",
        item_id: item.item_id,
        sheet_row: item.sheet_row,
        item_name: item.item_name,
        type: item.type,
        brand: item.brand,
        model: item.model,
        location: item.location,
        quantity: item.quantity,
        start_date: normalizedStartDate,
        end_date: normalizedEndDate,
      })),
      ...resolvedLaptopGroups.flatMap((group) =>
        group.laptops.map((laptop) => ({
          source: "laptop",
          laptop_id: laptop.laptop_id,
          item_name: laptop.name,
          quantity: 1,
          start_date: group.start_date,
          end_date: group.end_date,
        })),
      ),
    ];

    const fallbackStartDate =
      normalizedStartDate || resolvedLaptopGroups[0]?.start_date;
    const fallbackEndDate =
      normalizedEndDate || resolvedLaptopGroups[0]?.end_date;

    const { data: guestRequest, error: guestRequestError } = await supabase
      .from("guest_borrow_requests")
      .insert({
        guest_name: guest_name.trim(),
        telegram_handle: normalizedTelegram || "",
        department: department?.trim() || null,
        email: email?.trim() || null,
        purpose: trimmedPurpose,
        remarks: trimmedRemarks,
        loan_type: "temporary",
        start_date: fallbackStartDate,
        end_date: fallbackEndDate,
        items: serializedItems,
        status: autoApproveGuestRequests ? "approved" : "pending",
        admin_notes: autoApproveGuestRequests
          ? "Auto-approved by guest queue setting"
          : null,
      })
      .select("id")
      .single();

    if (guestRequestError) {
      return NextResponse.json(
        {
          error: mutationError(
            "Failed to create guest request",
            guestRequestError,
          ),
        },
        { status: 500 },
      );
    }

    if (!autoApproveGuestRequests) {
      await notifyAdmins({
        admins,
        guestName: guest_name.trim(),
        purpose: trimmedPurpose,
        remarks: trimmedRemarks,
        summaryLines: [`Guest request #${guestRequest.id}`, ...summaryLines],
        warnings,
      });
    }

    return NextResponse.json(
      withWarnings(
        {
          request_id: guestRequest.id,
          auto_approved: autoApproveGuestRequests,
          message: autoApproveGuestRequests
            ? "Guest borrow request auto-approved in the guest queue."
            : "Guest borrow request submitted for review.",
        },
        warnings,
      ),
    );
  } catch (error) {
    console.error("Guest request POST error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to submit guest request" },
      { status: 500 },
    );
  }
}
