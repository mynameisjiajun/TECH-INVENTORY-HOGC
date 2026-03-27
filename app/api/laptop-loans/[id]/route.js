import { supabase } from "@/lib/db/supabase";
import { getCurrentUser } from "@/lib/utils/auth";
import { sendTelegramMessage } from "@/lib/services/telegram";
import { NextResponse } from "next/server";

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
