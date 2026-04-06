import { supabase } from "@/lib/db/supabase";
import { getCurrentUser } from "@/lib/utils/auth";
import { invalidateAll } from "@/lib/utils/cache";
import { sendTelegramMessage } from "@/lib/services/telegram";
import { NextResponse } from "next/server";

export async function POST(request, { params }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { imageBase64, remarks } = await request.json();
    if (!imageBase64) {
      return NextResponse.json({ error: "Photo is required to return items" }, { status: 400 });
    }

    const unawaitedParams = await params;
    const loanId = unawaitedParams.id;
    if (!loanId) {
      return NextResponse.json({ error: "Loan ID is required" }, { status: 400 });
    }

    // Get loan from Supabase
    const { data: loan } = await supabase
      .from("loan_requests")
      .select("*")
      .eq("id", loanId)
      .single();

    if (!loan) {
      return NextResponse.json({ error: "Loan not found" }, { status: 404 });
    }
    if (Number(loan.user_id) !== Number(user.id) && user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized to return this loan" }, { status: 403 });
    }
    if (loan.status !== "approved") {
      return NextResponse.json({ error: "Loan is not eligible for return" }, { status: 400 });
    }

    // Upload photo to Supabase Storage
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    const fileName = `loan-${loanId}-${Date.now()}.jpg`;

    const { error: uploadError } = await supabase.storage
      .from("return-photos")
      .upload(fileName, buffer, { contentType: "image/jpeg", upsert: false });

    if (uploadError) throw new Error(`Photo upload failed: ${uploadError.message}`);

    const { data: urlData } = supabase.storage
      .from("return-photos")
      .getPublicUrl(fileName);
    const photoUrl = urlData.publicUrl;

    // Update loan status in Supabase
    await supabase
      .from("loan_requests")
      .update({
        status: "returned",
        return_photo_url: photoUrl,
        return_remarks: remarks || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", loanId);

    // Log activity and fetch admins in parallel
    const [{ data: loanUser }, { data: admins }] = await Promise.all([
      supabase.from("users").select("display_name, username").eq("id", loan.user_id).single(),
      supabase.from("users").select("id").eq("role", "admin"),
    ]);

    const remarksLine = remarks ? `\nRemarks: ${remarks}` : "";

    await supabase.from("activity_feed").insert({
      user_id: user.id,
      action: "return",
      description: `${loanUser?.display_name || "A user"} returned loan #${loanId}.${remarksLine}`,
    });

    if (admins && admins.length > 0) {
      await supabase.from("notifications").insert(
        admins.map((admin) => ({
          user_id: admin.id,
          message: `${loanUser?.display_name || "A user"} returned loan #${loanId}.${remarksLine} Tap to view proof photo.`,
          link: photoUrl,
        })),
      );

      for (const admin of admins) {
        sendTelegramMessage(
          admin.id,
          `📥 <b>Item Returned</b>\n${loanUser?.display_name} returned loan #${loanId}.${remarks ? `\n⚠️ <b>Remarks:</b> ${remarks}` : ""}\n<a href="${photoUrl}">View Proof Photo</a>`,
        ).catch(() => {});
      }
    }

    invalidateAll();

    return NextResponse.json({ message: "Items returned successfully!", photo_url: photoUrl });
  } catch (error) {
    console.error("Return loan error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
