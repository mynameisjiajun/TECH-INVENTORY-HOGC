import { supabase } from "@/lib/db/supabase";
import { getCurrentUser } from "@/lib/utils/auth";
import { sendTelegramMessage } from "@/lib/services/telegram";
import { NextResponse } from "next/server";

function notFoundError(error) {
  return error?.code === "PGRST116";
}

function errorMessage(prefix, error) {
  return error?.message ? `${prefix}: ${error.message}` : prefix;
}

function withWarnings(body, warnings) {
  if (!warnings.length) return body;
  return { ...body, warnings };
}

async function rollbackLoanRequestState({
  loanId,
  requestSnapshot,
  itemSnapshot,
}) {
  const warnings = [];

  const { error: requestRollbackError } = await supabase
    .from("laptop_loan_requests")
    .update(requestSnapshot)
    .eq("id", loanId);

  if (requestRollbackError) {
    warnings.push(
      errorMessage("Failed to restore loan request", requestRollbackError),
    );
  }

  const { error: deleteRollbackItemsError } = await supabase
    .from("laptop_loan_items")
    .delete()
    .eq("loan_request_id", loanId);

  if (deleteRollbackItemsError) {
    warnings.push(
      errorMessage(
        "Failed to clear replacement laptop items during rollback",
        deleteRollbackItemsError,
      ),
    );
    return warnings;
  }

  if (itemSnapshot.length > 0) {
    const { error: restoreItemsError } = await supabase
      .from("laptop_loan_items")
      .insert(
        itemSnapshot.map((item) => ({
          loan_request_id: loanId,
          laptop_id: item.laptop_id,
        })),
      );

    if (restoreItemsError) {
      warnings.push(
        errorMessage(
          "Failed to restore original laptop items",
          restoreItemsError,
        ),
      );
    }
  }

  return warnings;
}

async function insertNotifications(entries, warnings, contextLabel) {
  if (!entries.length) return;

  const { error } = await supabase.from("notifications").insert(entries);
  if (error) {
    warnings.push(
      errorMessage(`Failed to create ${contextLabel} notifications`, error),
    );
  }
}

// PUT: Modify an existing laptop loan request
export async function PUT(request, { params }) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const warnings = [];

  try {
    const { id } = await params;
    const { laptop_ids, loan_type, start_date, end_date, purpose, department } =
      await request.json();

    if (!laptop_ids?.length)
      return NextResponse.json(
        { error: "No laptops selected" },
        { status: 400 },
      );
    if (!purpose?.trim())
      return NextResponse.json(
        { error: "Purpose is required" },
        { status: 400 },
      );
    if (!start_date)
      return NextResponse.json(
        { error: "Start date is required" },
        { status: 400 },
      );
    if (loan_type === "temporary" && !end_date)
      return NextResponse.json(
        { error: "End date required for temporary loans" },
        { status: 400 },
      );
    if (loan_type === "permanent" && !["admin", "tech"].includes(user.role)) {
      return NextResponse.json(
        { error: "Only Tech team members can request permanent loans" },
        { status: 403 },
      );
    }

    const normalizedLaptopIds = [
      ...new Set(
        laptop_ids.map((value) => Number(value)).filter(Number.isFinite),
      ),
    ];
    if (!normalizedLaptopIds.length) {
      return NextResponse.json(
        { error: "No valid laptops selected" },
        { status: 400 },
      );
    }

    const { data: existingLoan, error: existingLoanError } = await supabase
      .from("laptop_loan_requests")
      .select("*, laptop_loan_items(laptop_id)")
      .eq("id", id)
      .single();

    if (existingLoanError && !notFoundError(existingLoanError)) {
      return NextResponse.json(
        {
          error: errorMessage("Failed to load laptop loan", existingLoanError),
        },
        { status: 500 },
      );
    }

    if (!existingLoan)
      return NextResponse.json({ error: "Loan not found" }, { status: 404 });
    if (
      Number(existingLoan.user_id) !== Number(user.id) &&
      user.role !== "admin"
    ) {
      return NextResponse.json(
        { error: "Unauthorized to modify this loan" },
        { status: 403 },
      );
    }
    if (
      existingLoan.status === "returned" ||
      existingLoan.status === "rejected"
    ) {
      return NextResponse.json(
        { error: "Cannot modify a returned or rejected loan" },
        { status: 400 },
      );
    }

    const { data: laptops, error: laptopsError } = await supabase
      .from("laptops")
      .select("id, name, is_perm_loaned")
      .in("id", normalizedLaptopIds);

    if (laptopsError) {
      return NextResponse.json(
        {
          error: errorMessage("Failed to load selected laptops", laptopsError),
        },
        { status: 500 },
      );
    }

    if ((laptops || []).length !== normalizedLaptopIds.length) {
      return NextResponse.json(
        { error: "One or more selected laptops no longer exist" },
        { status: 400 },
      );
    }

    for (const laptop of laptops || []) {
      if (laptop.is_perm_loaned) {
        return NextResponse.json(
          { error: `Laptop "${laptop.name}" is permanently loaned` },
          { status: 400 },
        );
      }
    }

    if (loan_type === "temporary") {
      const { data: conflicts, error: conflictsError } = await supabase
        .from("laptop_loan_requests")
        .select("id, start_date, end_date, laptop_loan_items(laptop_id)")
        .in("status", ["approved", "pending"])
        .neq("id", id);

      if (conflictsError) {
        return NextResponse.json(
          {
            error: errorMessage(
              "Failed to check laptop booking conflicts",
              conflictsError,
            ),
          },
          { status: 500 },
        );
      }

      for (const conflict of conflicts || []) {
        const cEnd = conflict.end_date || "9999-12-31";
        if (conflict.start_date <= end_date && cEnd >= start_date) {
          for (const item of conflict.laptop_loan_items || []) {
            if (normalizedLaptopIds.includes(item.laptop_id)) {
              const laptop = laptops?.find(
                (entry) => entry.id === item.laptop_id,
              );
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

    const oldLaptopIds = (existingLoan.laptop_loan_items || []).map(
      (i) => i.laptop_id,
    );
    const requestSnapshot = {
      loan_type: existingLoan.loan_type,
      start_date: existingLoan.start_date,
      end_date: existingLoan.end_date,
      purpose: existingLoan.purpose,
      department: existingLoan.department,
      status: existingLoan.status,
      admin_notes: existingLoan.admin_notes,
    };
    const itemSnapshot = existingLoan.laptop_loan_items || [];

    const { error: updateLoanError } = await supabase
      .from("laptop_loan_requests")
      .update({
        loan_type,
        start_date,
        end_date: loan_type === "temporary" ? end_date : null,
        purpose: purpose.trim(),
        department: department?.trim() || null,
        status: "pending",
        admin_notes: existingLoan.admin_notes
          ? `${existingLoan.admin_notes} (Modified by user)`
          : "Modified by user",
      })
      .eq("id", id);

    if (updateLoanError) {
      return NextResponse.json(
        {
          error: errorMessage(
            "Failed to update laptop loan request",
            updateLoanError,
          ),
        },
        { status: 500 },
      );
    }

    const { error: deleteItemsError } = await supabase
      .from("laptop_loan_items")
      .delete()
      .eq("loan_request_id", id);

    if (deleteItemsError) {
      const rollbackWarnings = await rollbackLoanRequestState({
        loanId: id,
        requestSnapshot,
        itemSnapshot,
      });
      return NextResponse.json(
        {
          error: errorMessage(
            "Failed to replace laptop loan items",
            deleteItemsError,
          ),
          details: rollbackWarnings,
        },
        { status: 500 },
      );
    }

    const { error: insertItemsError } = await supabase
      .from("laptop_loan_items")
      .insert(
        normalizedLaptopIds.map((laptopId) => ({
          loan_request_id: id,
          laptop_id: laptopId,
        })),
      );

    if (insertItemsError) {
      const rollbackWarnings = await rollbackLoanRequestState({
        loanId: id,
        requestSnapshot,
        itemSnapshot,
      });
      return NextResponse.json(
        {
          error: errorMessage(
            "Failed to save replacement laptop items",
            insertItemsError,
          ),
          details: rollbackWarnings,
        },
        { status: 500 },
      );
    }

    if (
      existingLoan.status === "approved" &&
      existingLoan.loan_type === "permanent" &&
      oldLaptopIds.length > 0
    ) {
      const { error: releaseOldLaptopsError } = await supabase
        .from("laptops")
        .update({
          is_perm_loaned: false,
          perm_loan_person: null,
          perm_loan_reason: null,
        })
        .in("id", oldLaptopIds);

      if (releaseOldLaptopsError) {
        const rollbackWarnings = await rollbackLoanRequestState({
          loanId: id,
          requestSnapshot,
          itemSnapshot,
        });
        return NextResponse.json(
          {
            error: errorMessage(
              "Failed to release previously assigned permanent laptops",
              releaseOldLaptopsError,
            ),
            details: rollbackWarnings,
          },
          { status: 500 },
        );
      }
    }

    const { data: admins, error: adminsError } = await supabase
      .from("users")
      .select("id, mute_telegram")
      .eq("role", "admin");

    if (adminsError) {
      warnings.push(
        errorMessage("Failed to load admin recipients", adminsError),
      );
    }

    const laptopNames = (laptops || []).map((entry) => entry.name).join(", ");
    if (admins?.length) {
      await insertNotifications(
        admins.map((admin) => ({
          user_id: admin.id,
          message: `${user.display_name} modified laptop loan request #${id} (now pending approval).`,
          link: "/admin",
        })),
        warnings,
        "admin",
      );

      for (const admin of admins) {
        if (!admin.mute_telegram) {
          sendTelegramMessage(
            admin.id,
            `📝 <b>Laptop Loan Modified</b>\n<b>${user.display_name}</b> modified loan #${id}.\nLaptops: ${laptopNames}`,
          ).catch(() => {});
        }
      }
    }

    await insertNotifications(
      [
        {
          user_id: user.id,
          message: `Your laptop loan request #${id} has been updated and is pending approval.`,
          link: "/loans",
        },
      ],
      warnings,
      "requester",
    );

    return NextResponse.json(
      withWarnings(
        {
          message:
            "Laptop loan modified successfully and is now pending approval.",
        },
        warnings,
      ),
    );
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to modify laptop loan request" },
      { status: 500 },
    );
  }
}

export async function POST(request, { params }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const warnings = [];

  try {
    const { id } = await params;
    const { action, admin_notes } = await request.json();

    if (!["approve", "reject", "return"].includes(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const { data: loan, error: loanError } = await supabase
      .from("laptop_loan_requests")
      .select(
        "*, users(id, display_name, mute_telegram, mute_emails), laptop_loan_items(laptop_id, laptops(name))",
      )
      .eq("id", id)
      .single();

    if (loanError && !notFoundError(loanError)) {
      return NextResponse.json(
        { error: errorMessage("Failed to load laptop loan", loanError) },
        { status: 500 },
      );
    }

    if (!loan)
      return NextResponse.json({ error: "Loan not found" }, { status: 404 });

    const newStatus =
      action === "approve"
        ? "approved"
        : action === "reject"
          ? "rejected"
          : "returned";
    const previousStatus = loan.status;
    const previousAdminNotes = loan.admin_notes;
    const laptopIds = (loan.laptop_loan_items || []).map(
      (item) => item.laptop_id,
    );

    if (action === "approve" && previousStatus !== "pending") {
      return NextResponse.json(
        { error: "Only pending laptop loans can be approved" },
        { status: 400 },
      );
    }

    if (action === "reject" && previousStatus !== "pending") {
      return NextResponse.json(
        { error: "Only pending laptop loans can be rejected" },
        { status: 400 },
      );
    }

    if (action === "return" && previousStatus !== "approved") {
      return NextResponse.json(
        { error: "Only approved laptop loans can be marked returned" },
        { status: 400 },
      );
    }

    const { error: updateLoanError } = await supabase
      .from("laptop_loan_requests")
      .update({
        status: newStatus,
        admin_notes: admin_notes || loan.admin_notes,
      })
      .eq("id", id);

    if (updateLoanError) {
      return NextResponse.json(
        {
          error: errorMessage(
            "Failed to update laptop loan status",
            updateLoanError,
          ),
        },
        { status: 500 },
      );
    }

    if (
      action === "approve" &&
      loan.loan_type === "permanent" &&
      laptopIds.length > 0
    ) {
      const { error: approvePermanentError } = await supabase
        .from("laptops")
        .update({
          is_perm_loaned: true,
          perm_loan_person: loan.users?.display_name || null,
          perm_loan_reason: loan.purpose || null,
        })
        .in("id", laptopIds);

      if (approvePermanentError) {
        await supabase
          .from("laptop_loan_requests")
          .update({ status: previousStatus, admin_notes: previousAdminNotes })
          .eq("id", id);

        return NextResponse.json(
          {
            error: errorMessage(
              "Failed to assign permanent laptop state",
              approvePermanentError,
            ),
          },
          { status: 500 },
        );
      }
    }

    if (
      action === "return" &&
      loan.loan_type === "permanent" &&
      laptopIds.length > 0
    ) {
      const { error: releasePermanentError } = await supabase
        .from("laptops")
        .update({
          is_perm_loaned: false,
          perm_loan_person: null,
          perm_loan_reason: null,
        })
        .in("id", laptopIds);

      if (releasePermanentError) {
        await supabase
          .from("laptop_loan_requests")
          .update({ status: previousStatus, admin_notes: previousAdminNotes })
          .eq("id", id);

        return NextResponse.json(
          {
            error: errorMessage(
              "Failed to release permanent laptop state",
              releasePermanentError,
            ),
          },
          { status: 500 },
        );
      }
    }

    if (action === "return" && laptopIds.length > 0) {
      const { data: notifSubscribers, error: notifSubscribersError } =
        await supabase
          .from("laptop_notifications")
          .select("user_id, laptop_id, laptops(name)")
          .in("laptop_id", laptopIds);

      if (notifSubscribersError) {
        warnings.push(
          errorMessage(
            "Failed to load laptop availability subscribers",
            notifSubscribersError,
          ),
        );
      }

      if (notifSubscribers?.length) {
        const { error: subscriberNotificationsError } = await supabase
          .from("notifications")
          .insert(
            notifSubscribers.map((entry) => ({
              user_id: entry.user_id,
              message: `Laptop "${entry.laptops?.name}" is now available to borrow!`,
              link: "/inventory/laptop-loans",
            })),
          );

        if (subscriberNotificationsError) {
          warnings.push(
            errorMessage(
              "Failed to create laptop availability notifications",
              subscriberNotificationsError,
            ),
          );
        } else {
          const { error: cleanupSubscribersError } = await supabase
            .from("laptop_notifications")
            .delete()
            .in("laptop_id", laptopIds);

          if (cleanupSubscribersError) {
            warnings.push(
              errorMessage(
                "Failed to clear laptop availability subscriptions",
                cleanupSubscribersError,
              ),
            );
          }
        }
      }
    }

    const requester = loan.users;
    if (requester) {
      const laptopList = loan.laptop_loan_items
        .map((item) => item.laptops?.name)
        .filter(Boolean)
        .join(", ");
      const msg =
        action === "approve"
          ? `Your laptop loan request #${id} for [${laptopList}] has been approved!`
          : action === "reject"
            ? `Your laptop loan request #${id} has been rejected.${admin_notes ? ` Note: ${admin_notes}` : ""}`
            : `Laptop loan #${id} has been marked as returned.`;

      await insertNotifications(
        [
          {
            user_id: requester.id,
            message: msg,
            link: "/loans",
          },
        ],
        warnings,
        "requester",
      );

      if (!requester.mute_telegram) {
        const emoji =
          action === "approve" ? "✅" : action === "reject" ? "❌" : "📥";
        sendTelegramMessage(requester.id, `${emoji} ${msg}`).catch(() => {});
      }
    }

    return NextResponse.json(
      withWarnings({ message: `Loan ${action}d successfully` }, warnings),
    );
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to update laptop loan" },
      { status: 500 },
    );
  }
}

// DELETE: Cancel own pending laptop loan request
export async function DELETE(_request, { params }) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const warnings = [];

  try {
    const { id } = await params;

    const { data: loan, error: loanError } = await supabase
      .from("laptop_loan_requests")
      .select("id, user_id, status, laptop_loan_items(laptop_id)")
      .eq("id", id)
      .single();

    if (loanError && !notFoundError(loanError)) {
      return NextResponse.json(
        { error: errorMessage("Failed to load laptop loan", loanError) },
        { status: 500 },
      );
    }

    if (!loan)
      return NextResponse.json({ error: "Loan not found" }, { status: 404 });
    if (Number(loan.user_id) !== Number(user.id) && user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    if (loan.status !== "pending") {
      return NextResponse.json(
        { error: "Only pending loans can be cancelled" },
        { status: 400 },
      );
    }

    const itemSnapshot = loan.laptop_loan_items || [];

    const { error: deleteItemsError } = await supabase
      .from("laptop_loan_items")
      .delete()
      .eq("loan_request_id", id);

    if (deleteItemsError) {
      return NextResponse.json(
        {
          error: errorMessage(
            "Failed to delete laptop loan items",
            deleteItemsError,
          ),
        },
        { status: 500 },
      );
    }

    const { error: deleteLoanError } = await supabase
      .from("laptop_loan_requests")
      .delete()
      .eq("id", id);

    if (deleteLoanError) {
      if (itemSnapshot.length > 0) {
        const { error: restoreItemsError } = await supabase
          .from("laptop_loan_items")
          .insert(
            itemSnapshot.map((item) => ({
              loan_request_id: id,
              laptop_id: item.laptop_id,
            })),
          );

        if (restoreItemsError) {
          warnings.push(
            errorMessage(
              "Failed to restore laptop loan items after cancellation failure",
              restoreItemsError,
            ),
          );
        }
      }

      return NextResponse.json(
        {
          error: errorMessage("Failed to cancel laptop loan", deleteLoanError),
          details: warnings,
        },
        { status: 500 },
      );
    }

    await insertNotifications(
      [
        {
          user_id: user.id,
          message: `Your laptop loan request #${id} has been cancelled.`,
          link: "/loans",
        },
      ],
      warnings,
      "requester",
    );

    return NextResponse.json(
      withWarnings({ message: "Loan cancelled successfully." }, warnings),
    );
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to cancel laptop loan" },
      { status: 500 },
    );
  }
}
