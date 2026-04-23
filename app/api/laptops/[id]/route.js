import { supabase } from "@/lib/db/supabase";
import { getCurrentUser } from "@/lib/utils/auth";
import { sendAdminTelegramAlert } from "@/lib/services/adminTelegram";
import { sendTelegramMessage } from "@/lib/services/telegram";
import { escapeHtml } from "@/lib/utils/html";
import { NextResponse } from "next/server";

export async function PUT(request, { params }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const { name, tier_id, screen_size, cpu, ram, storage, condition, is_perm_loaned, perm_loan_person, perm_loan_reason } = body;

  const updateData = {};
  if (name !== undefined) updateData.name = name.trim();
  if (tier_id !== undefined) updateData.tier_id = tier_id || null;
  if (screen_size !== undefined) updateData.screen_size = screen_size;
  if (cpu !== undefined) updateData.cpu = cpu;
  if (ram !== undefined) updateData.ram = ram;
  if (storage !== undefined) updateData.storage = storage;
  if (condition !== undefined) updateData.condition = condition;
  if (is_perm_loaned !== undefined) {
    updateData.is_perm_loaned = is_perm_loaned;
    updateData.perm_loan_person = is_perm_loaned ? (perm_loan_person || null) : null;
    updateData.perm_loan_reason = is_perm_loaned ? (perm_loan_reason || null) : null;
  }

  const { data: existingLaptop } = await supabase
    .from("laptops")
    .select("id, name, is_perm_loaned, perm_loan_person, perm_loan_reason")
    .eq("id", id)
    .single();

  const { data, error } = await supabase
    .from("laptops")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const safeAdmin = escapeHtml(user.display_name || user.username || "Admin");
  const safeLaptopName = escapeHtml(data.name || "");
  const safeAssignee = escapeHtml(perm_loan_person || "Unspecified");
  const safeReason = perm_loan_reason ? escapeHtml(perm_loan_reason) : "";

  if (is_perm_loaned === true) {
    sendAdminTelegramAlert(
      `💻 <b>Laptop Permanently Assigned</b>\n<b>${safeAdmin}</b> assigned <b>${safeLaptopName}</b>.\nAssignee: ${safeAssignee}${safeReason ? `\nReason: ${safeReason}` : ""}`,
    ).catch((err) => console.error("laptop perm-assign admin telegram failed:", err?.message || err));
  }

  if (is_perm_loaned === false && existingLaptop?.is_perm_loaned) {
    const safePrevAssignee = escapeHtml(
      existingLaptop.perm_loan_person || "Unspecified",
    );
    sendAdminTelegramAlert(
      `↩️ <b>Laptop Released</b>\n<b>${safeAdmin}</b> released <b>${safeLaptopName}</b> from permanent assignment.\nPrevious assignee: ${safePrevAssignee}`,
    ).catch((err) => console.error("laptop release admin telegram failed:", err?.message || err));
  }

  // If toggling perm loan on, notify the person if we have their user record
  if (is_perm_loaned && perm_loan_person) {
    const { data: loanUser } = await supabase
      .from("users")
      .select("id, mute_telegram, mute_emails")
      .ilike("display_name", perm_loan_person)
      .maybeSingle();
    if (loanUser) {
      await supabase.from("notifications").insert({
        user_id: loanUser.id,
        message: `Laptop "${data.name}" has been marked as permanently loaned to you.`,
        link: "/inventory/laptop-loans",
      });
      if (!loanUser.mute_telegram) {
        sendTelegramMessage(
          loanUser.id,
          `💻 Laptop <b>${safeLaptopName}</b> has been permanently assigned to you.`,
        ).catch((err) => console.error("laptop perm-assign user telegram failed:", err?.message || err));
      }
    }
  }

  return NextResponse.json({ laptop: data });
}

export async function DELETE(request, { params }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const { error } = await supabase.from("laptops").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ message: "Laptop deleted" });
}
