import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import { getCurrentUser } from "@/lib/utils/auth";
import { sendTelegramMessage } from "@/lib/services/telegram";
import { fmtDatetime } from "@/lib/laptops";

export async function PATCH(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const { data: loan, error: fetchError } = await supabase
    .from("laptop_loans")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchError || !loan) {
    return NextResponse.json({ error: "Loan not found" }, { status: 404 });
  }

  if (user.role !== "admin" && loan.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const returnDatetime = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("laptop_loans")
    .update({
      status: "returned",
      return_datetime: returnDatetime,
      returned_by: user.display_name || user.username,
      return_remarks: body.returnRemarks || null,
      checklist_checked: body.checkedItems || null,
      checklist_unchecked: body.uncheckedItems || null,
    })
    .eq("id", id);

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  const returnFmt = fmtDatetime(returnDatetime);

  const lines = [
    `✅ <b>Laptop Returned</b>`,
    ``,
    `<b>${loan.laptop_id}</b> has been successfully returned.`,
    ``,
    `📅 <b>Returned:</b> ${returnFmt}`,
  ];

  if (body.checkedItems?.length || body.uncheckedItems?.length) {
    lines.push(``, `📋 <b>Checklist</b>`);
    for (const item of body.checkedItems ?? []) lines.push(`✅ ${item}`);
    for (const item of body.uncheckedItems ?? []) lines.push(`❌ ${item}`);
  }
  if (body.returnRemarks) lines.push(``, `📝 <b>Remarks:</b> ${body.returnRemarks}`);
  lines.push(``, `Thank you!`);

  await sendTelegramMessage(loan.user_id, lines.join("\n"));

  return NextResponse.json({ ok: true });
}
