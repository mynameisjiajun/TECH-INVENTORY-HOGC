import { supabase } from "@/lib/db/supabase";
import { getCurrentUser } from "@/lib/utils/auth";
import { invalidateAll } from "@/lib/utils/cache";
import { sendTelegramMessage } from "@/lib/services/telegram";
import { NextResponse } from "next/server";
import {
  deleteStorageObjectBestEffort,
  insertRowsBestEffort,
  isNotFoundError,
  mutationError,
  withWarnings,
} from "@/lib/utils/mutationSafety";

export async function POST(request, { params }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const warnings = [];
    const { imageBase64, remarks } = await request.json();
    if (!imageBase64) {
      return NextResponse.json(
        { error: "Photo is required to return items" },
        { status: 400 },
      );
    }

    const unawaitedParams = await params;
    const loanId = unawaitedParams.id;
    if (!loanId) {
      return NextResponse.json(
        { error: "Loan ID is required" },
        { status: 400 },
      );
    }

    // Get loan from Supabase
    const { data: loan, error: loanError } = await supabase
      .from("loan_requests")
      .select("*")
      .eq("id", loanId)
      .single();

    if (loanError && !isNotFoundError(loanError)) {
      return NextResponse.json(
        { error: mutationError("Failed to load loan", loanError) },
        { status: 500 },
      );
    }

    if (!loan) {
      return NextResponse.json({ error: "Loan not found" }, { status: 404 });
    }
    if (Number(loan.user_id) !== Number(user.id) && user.role !== "admin") {
      return NextResponse.json(
        { error: "Unauthorized to return this loan" },
        { status: 403 },
      );
    }
    if (loan.status !== "approved") {
      return NextResponse.json(
        { error: "Loan is not eligible for return" },
        { status: 400 },
      );
    }

    // Upload photo to Supabase Storage
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    const fileName = `loan-${loanId}-${Date.now()}.jpg`;

    const { error: uploadError } = await supabase.storage
      .from("return-photos")
      .upload(fileName, buffer, { contentType: "image/jpeg", upsert: false });

    if (uploadError)
      throw new Error(`Photo upload failed: ${uploadError.message}`);

    const photoBucket = supabase.storage.from("return-photos");
    const { data: urlData } = photoBucket.getPublicUrl(fileName);
    const photoUrl = urlData.publicUrl;

    const { error: updateLoanError } = await supabase
      .from("loan_requests")
      .update({
        status: "returned",
        return_photo_url: photoUrl,
        return_remarks: remarks || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", loanId);

    if (updateLoanError) {
      await deleteStorageObjectBestEffort({
        bucket: photoBucket,
        path: fileName,
        warnings,
        context: "uploaded return photo",
      });
      return NextResponse.json(
        {
          error: mutationError(
            "Failed to mark loan as returned",
            updateLoanError,
          ),
          details: warnings,
        },
        { status: 500 },
      );
    }

    // Log activity and fetch admins in parallel
    const [
      { data: loanUser, error: loanUserError },
      { data: admins, error: adminsError },
    ] = await Promise.all([
      supabase
        .from("users")
        .select("display_name, username")
        .eq("id", loan.user_id)
        .single(),
      supabase.from("users").select("id").eq("role", "admin"),
    ]);

    if (loanUserError && !isNotFoundError(loanUserError)) {
      warnings.push(
        mutationError("Failed to load requester profile", loanUserError),
      );
    }
    if (adminsError) {
      warnings.push(
        mutationError("Failed to load admin recipients", adminsError),
      );
    }

    const remarksLine = remarks ? `\nRemarks: ${remarks}` : "";

    await insertRowsBestEffort({
      client: supabase,
      table: "activity_feed",
      entries: [
        {
          user_id: user.id,
          action: "return",
          description: `${loanUser?.display_name || "A user"} returned loan #${loanId}.${remarksLine}`,
        },
      ],
      warnings,
      context: "return activity",
    });

    if (admins && admins.length > 0) {
      await insertRowsBestEffort({
        client: supabase,
        table: "notifications",
        entries: admins.map((admin) => ({
          user_id: admin.id,
          message: `${loanUser?.display_name || "A user"} returned loan #${loanId}.${remarksLine} Tap to view proof photo.`,
          link: photoUrl,
        })),
        warnings,
        context: "admin return",
      });

      for (const admin of admins) {
        sendTelegramMessage(
          admin.id,
          `📥 <b>Item Returned</b>\n${loanUser?.display_name} returned loan #${loanId}.${remarks ? `\n⚠️ <b>Remarks:</b> ${remarks}` : ""}\n<a href="${photoUrl}">View Proof Photo</a>`,
        ).catch(() => {});
      }
    }

    invalidateAll();

    return NextResponse.json(
      withWarnings(
        { message: "Items returned successfully!", photo_url: photoUrl },
        warnings,
      ),
    );
  } catch (error) {
    console.error("Return loan error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 },
    );
  }
}
