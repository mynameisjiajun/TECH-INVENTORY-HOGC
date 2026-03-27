import { supabase } from "@/lib/db/supabase";
import { getCurrentUser } from "@/lib/utils/auth";
import { sendTelegramMessage } from "@/lib/services/telegram";
import { NextResponse } from "next/server";

export async function POST(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { imageBase64, remarks } = await request.json();

  if (!imageBase64) {
    return NextResponse.json({ error: "Photo is required to return items" }, { status: 400 });
  }

  const { data: loan } = await supabase
    .from("laptop_loan_requests")
    .select("*, laptop_loan_items(laptop_id, laptops(name))")
    .eq("id", id)
    .single();

  if (!loan) return NextResponse.json({ error: "Loan not found" }, { status: 404 });
  if (Number(loan.user_id) !== Number(user.id) && user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  if (loan.status !== "approved" || loan.loan_type !== "temporary") {
    return NextResponse.json({ error: "Only approved temporary loans can be returned this way" }, { status: 400 });
  }

  // Upload photo
  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");
  const fileName = `laptop-loan-${id}-${Date.now()}.jpg`;

  const { error: uploadError } = await supabase.storage
    .from("return-photos")
    .upload(fileName, buffer, { contentType: "image/jpeg", upsert: false });

  if (uploadError) throw new Error(`Photo upload failed: ${uploadError.message}`);

  const { data: urlData } = supabase.storage.from("return-photos").getPublicUrl(fileName);
  const photoUrl = urlData.publicUrl;

  await supabase
    .from("laptop_loan_requests")
    .update({ status: "returned", return_photo_url: photoUrl })
    .eq("id", id);

  // Notify users who had "notify me" on these laptops
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
    await supabase.from("laptop_notifications").delete().in("laptop_id", laptopIds);
  }

  // Notify admins
  const { data: admins } = await supabase.from("users").select("id, mute_telegram").eq("role", "admin");
  const laptopNames = loan.laptop_loan_items.map((i) => i.laptops?.name).filter(Boolean).join(", ");
  const remarksLine = remarks ? `\nRemarks: ${remarks}` : "";

  if (admins?.length) {
    await supabase.from("notifications").insert(
      admins.map((a) => ({
        user_id: a.id,
        message: `Laptop loan #${id} [${laptopNames}] has been returned.${remarksLine}`,
        link: photoUrl,
      }))
    );
    for (const admin of admins) {
      if (!admin.mute_telegram) {
        sendTelegramMessage(
          admin.id,
          `📥 <b>Laptop Returned</b>\nLoan #${id} [${laptopNames}] returned.${remarks ? `\n⚠️ ${remarks}` : ""}\n<a href="${photoUrl}">View Photo</a>`
        ).catch(() => {});
      }
    }
  }

  return NextResponse.json({ message: "Laptop returned successfully!", photo_url: photoUrl });
}
