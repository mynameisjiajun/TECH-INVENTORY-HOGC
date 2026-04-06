import { supabase } from "@/lib/db/supabase";
import { getCurrentUser } from "@/lib/utils/auth";
import { sendTelegramMessage } from "@/lib/services/telegram";
import { NextResponse } from "next/server";

// PUT: Modify an existing laptop loan request
export async function PUT(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { laptop_ids, loan_type, start_date, end_date, purpose, department } = await request.json();

  if (!laptop_ids?.length) return NextResponse.json({ error: "No laptops selected" }, { status: 400 });
  if (!purpose?.trim()) return NextResponse.json({ error: "Purpose is required" }, { status: 400 });
  if (!start_date) return NextResponse.json({ error: "Start date is required" }, { status: 400 });
  if (loan_type === "temporary" && !end_date) return NextResponse.json({ error: "End date required for temporary loans" }, { status: 400 });
  if (loan_type === "permanent" && !["admin", "tech"].includes(user.role)) {
    return NextResponse.json({ error: "Only Tech team members can request permanent loans" }, { status: 403 });
  }

  // Fetch existing loan
  const { data: existingLoan } = await supabase
    .from("laptop_loan_requests")
    .select("*, laptop_loan_items(laptop_id)")
    .eq("id", id)
    .single();

  if (!existingLoan) return NextResponse.json({ error: "Loan not found" }, { status: 404 });
  if (Number(existingLoan.user_id) !== Number(user.id) && user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized to modify this loan" }, { status: 403 });
  }
  if (existingLoan.status === "returned" || existingLoan.status === "rejected") {
    return NextResponse.json({ error: "Cannot modify a returned or rejected loan" }, { status: 400 });
  }

  // Verify new laptops exist and aren't permanently loaned by someone else
  const { data: laptops } = await supabase.from("laptops").select("id, name, is_perm_loaned").in("id", laptop_ids);
  for (const laptop of laptops || []) {
    if (laptop.is_perm_loaned) {
      return NextResponse.json({ error: `Laptop "${laptop.name}" is permanently loaned` }, { status: 400 });
    }
  }

  // Check date conflicts for new laptops (temp loans only), excluding the current loan
  if (loan_type === "temporary") {
    const { data: conflicts } = await supabase
      .from("laptop_loan_requests")
      .select("id, start_date, end_date, laptop_loan_items(laptop_id)")
      .in("status", ["approved", "pending"])
      .neq("id", id);

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

  // If the loan was approved + permanent, un-perm the old laptops before swapping
  if (existingLoan.status === "approved" && existingLoan.loan_type === "permanent") {
    const oldLaptopIds = (existingLoan.laptop_loan_items || []).map((i) => i.laptop_id);
    if (oldLaptopIds.length > 0) {
      await supabase.from("laptops")
        .update({ is_perm_loaned: false, perm_loan_person: null, perm_loan_reason: null })
        .in("id", oldLaptopIds);
    }
  }

  // Update the loan record (revert to pending)
  await supabase.from("laptop_loan_requests").update({
    loan_type,
    start_date,
    end_date: loan_type === "temporary" ? end_date : null,
    purpose: purpose.trim(),
    department: department?.trim() || null,
    status: "pending",
    admin_notes: existingLoan.admin_notes
      ? `${existingLoan.admin_notes} (Modified by user)`
      : "Modified by user",
  }).eq("id", id);

  // Replace items
  await supabase.from("laptop_loan_items").delete().eq("loan_request_id", id);
  await supabase.from("laptop_loan_items").insert(
    laptop_ids.map((lid) => ({ loan_request_id: id, laptop_id: lid }))
  );

  // Notify admins
  const { data: admins } = await supabase.from("users").select("id, mute_telegram").eq("role", "admin");
  const laptopNames = (laptops || []).map((l) => l.name).join(", ");
  if (admins?.length) {
    await supabase.from("notifications").insert(
      admins.map((a) => ({
        user_id: a.id,
        message: `${user.display_name} modified laptop loan request #${id} (now pending approval).`,
        link: "/admin",
      }))
    );
    for (const admin of admins) {
      if (!admin.mute_telegram) {
        sendTelegramMessage(
          admin.id,
          `📝 <b>Laptop Loan Modified</b>\n<b>${user.display_name}</b> modified loan #${id}.\nLaptops: ${laptopNames}`
        ).catch(() => {});
      }
    }
  }

  // Notify the user
  await supabase.from("notifications").insert({
    user_id: user.id,
    message: `Your laptop loan request #${id} has been updated and is pending approval.`,
    link: "/loans",
  });

  return NextResponse.json({ message: "Laptop loan modified successfully and is now pending approval." });
}

export async function POST(request, { params }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { action, admin_notes } = await request.json();

  if (!["approve", "reject", "return"].includes(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const { data: loan } = await supabase
    .from("laptop_loan_requests")
    .select("*, users(id, display_name, mute_telegram, mute_emails), laptop_loan_items(laptop_id, laptops(name))")
    .eq("id", id)
    .single();

  if (!loan) return NextResponse.json({ error: "Loan not found" }, { status: 404 });

  const newStatus = action === "approve" ? "approved" : action === "reject" ? "rejected" : "returned";

  await supabase
    .from("laptop_loan_requests")
    .update({ status: newStatus, admin_notes: admin_notes || loan.admin_notes })
    .eq("id", id);

  // If approving a permanent loan, mark laptops as perm loaned
  if (action === "approve" && loan.loan_type === "permanent") {
    const laptopIds = loan.laptop_loan_items.map((i) => i.laptop_id);
    await supabase
      .from("laptops")
      .update({
        is_perm_loaned: true,
        perm_loan_person: loan.users?.display_name || null,
        perm_loan_reason: loan.purpose || null,
      })
      .in("id", laptopIds);
  }

  // If returning a permanent loan, unmark laptops
  if (action === "return" && loan.loan_type === "permanent") {
    const laptopIds = loan.laptop_loan_items.map((i) => i.laptop_id);
    await supabase
      .from("laptops")
      .update({ is_perm_loaned: false, perm_loan_person: null, perm_loan_reason: null })
      .in("id", laptopIds);
  }

  // If returning / becoming available, notify users who had notify-me on these laptops
  if (action === "return") {
    const laptopIds = loan.laptop_loan_items.map((i) => i.laptop_id);
    const { data: notifSubscribers } = await supabase
      .from("laptop_notifications")
      .select("user_id, laptop_id, laptops(name)")
      .in("laptop_id", laptopIds);

    if (notifSubscribers?.length) {
      await supabase.from("notifications").insert(
        notifSubscribers.map((n) => ({
          user_id: n.user_id,
          message: `Laptop "${n.laptops?.name}" is now available to borrow!`,
          link: "/inventory/laptop-loans",
        }))
      );
      // Clean up notify-me entries
      await supabase.from("laptop_notifications").delete().in("laptop_id", laptopIds);
    }
  }

  // Notify the requester
  const requester = loan.users;
  if (requester) {
    const laptopList = loan.laptop_loan_items.map((i) => i.laptops?.name).filter(Boolean).join(", ");
    const msg =
      action === "approve"
        ? `Your laptop loan request #${id} for [${laptopList}] has been approved!`
        : action === "reject"
        ? `Your laptop loan request #${id} has been rejected.${admin_notes ? ` Note: ${admin_notes}` : ""}`
        : `Laptop loan #${id} has been marked as returned.`;

    await supabase.from("notifications").insert({
      user_id: requester.id,
      message: msg,
      link: "/loans",
    });

    if (!requester.mute_telegram) {
      const emoji = action === "approve" ? "✅" : action === "reject" ? "❌" : "📥";
      sendTelegramMessage(requester.id, `${emoji} ${msg}`).catch(() => {});
    }
  }

  return NextResponse.json({ message: `Loan ${action}d successfully` });
}

// DELETE: Cancel own pending laptop loan request
export async function DELETE(_request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const { data: loan } = await supabase
    .from("laptop_loan_requests")
    .select("id, user_id, status")
    .eq("id", id)
    .single();

  if (!loan) return NextResponse.json({ error: "Loan not found" }, { status: 404 });
  if (Number(loan.user_id) !== Number(user.id) && user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  if (loan.status !== "pending") {
    return NextResponse.json({ error: "Only pending loans can be cancelled" }, { status: 400 });
  }

  await supabase.from("laptop_loan_items").delete().eq("loan_request_id", id);
  await supabase.from("laptop_loan_requests").delete().eq("id", id);

  await supabase.from("notifications").insert({
    user_id: user.id,
    message: `Your laptop loan request #${id} has been cancelled.`,
    link: "/loans",
  });

  return NextResponse.json({ message: "Loan cancelled successfully." });
}
