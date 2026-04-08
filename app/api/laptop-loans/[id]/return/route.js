import { supabase } from "@/lib/db/supabase";
import { getCurrentUser } from "@/lib/utils/auth";
import { sendTelegramMessage } from "@/lib/services/telegram";
import { sendLaptopAvailableEmail } from "@/lib/services/email";
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
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const warnings = [];

  try {
    const { id } = await params;
    const { imageBase64, remarks } = await request.json();

    if (!imageBase64) {
      return NextResponse.json(
        { error: "Photo is required to return items" },
        { status: 400 },
      );
    }

    const { data: loan, error: loanError } = await supabase
      .from("laptop_loan_requests")
      .select("*, laptop_loan_items(laptop_id, laptops(name))")
      .eq("id", id)
      .single();

    if (loanError && !isNotFoundError(loanError)) {
      return NextResponse.json(
        { error: mutationError("Failed to load laptop loan", loanError) },
        { status: 500 },
      );
    }

    if (!loan)
      return NextResponse.json({ error: "Loan not found" }, { status: 404 });
    if (Number(loan.user_id) !== Number(user.id) && user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    if (loan.status !== "approved") {
      return NextResponse.json(
        { error: "Only approved loans can be returned" },
        { status: 400 },
      );
    }

    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    const fileName = `laptop-loan-${id}-${Date.now()}.jpg`;

    const { error: uploadError } = await supabase.storage
      .from("return-photos")
      .upload(fileName, buffer, { contentType: "image/jpeg", upsert: false });

    if (uploadError)
      throw new Error(`Photo upload failed: ${uploadError.message}`);

    const photoBucket = supabase.storage.from("return-photos");
    const { data: urlData } = photoBucket.getPublicUrl(fileName);
    const photoUrl = urlData.publicUrl;

    const { error: updateLoanError } = await supabase
      .from("laptop_loan_requests")
      .update({ status: "returned", return_photo_url: photoUrl })
      .eq("id", id);

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
            "Failed to mark laptop loan as returned",
            updateLoanError,
          ),
          details: warnings,
        },
        { status: 500 },
      );
    }

    const laptopIds = loan.laptop_loan_items.map((item) => item.laptop_id);
    const { data: notifSubscribers, error: notifSubscribersError } =
      await supabase
        .from("laptop_notifications")
        .select("user_id, laptop_id, laptops(name)")
        .in("laptop_id", laptopIds);

    if (notifSubscribersError) {
      warnings.push(
        mutationError(
          "Failed to load laptop availability subscribers",
          notifSubscribersError,
        ),
      );
    }

    if (notifSubscribers?.length) {
      const notificationsInserted = await insertRowsBestEffort({
        client: supabase,
        table: "notifications",
        entries: notifSubscribers.map((entry) => ({
          user_id: entry.user_id,
          message: `💻 Laptop "${entry.laptops?.name}" is now available to borrow!`,
          link: "/inventory/laptop-loans",
        })),
        warnings,
        context: "laptop availability",
      });

      const subscriberIds = [
        ...new Set(notifSubscribers.map((entry) => entry.user_id)),
      ];
      const { data: subUsers, error: subUsersError } = await supabase
        .from("users")
        .select("id, email, display_name, mute_emails, mute_telegram")
        .in("id", subscriberIds);

      if (subUsersError) {
        warnings.push(
          mutationError(
            "Failed to load subscriber delivery preferences",
            subUsersError,
          ),
        );
      }

      const subUserMap = new Map(
        (subUsers || []).map((entry) => [entry.id, entry]),
      );

      for (const entry of notifSubscribers) {
        const subUser = subUserMap.get(entry.user_id);
        if (!subUser) continue;
        const laptopName = entry.laptops?.name || "Laptop";

        if (!subUser.mute_telegram) {
          sendTelegramMessage(
            entry.user_id,
            `💻 <b>Laptop Available!</b>\n<b>${laptopName}</b> is now available to borrow.\n\nHead to the app to reserve it!`,
          ).catch(() => {});
        }
        if (subUser.email && !subUser.mute_emails) {
          sendLaptopAvailableEmail({
            to: subUser.email,
            displayName: subUser.display_name,
            laptopName,
          }).catch(() => {});
        }
      }

      if (notificationsInserted) {
        const { error: deleteSubscriptionsError } = await supabase
          .from("laptop_notifications")
          .delete()
          .in("laptop_id", laptopIds);

        if (deleteSubscriptionsError) {
          warnings.push(
            mutationError(
              "Failed to clear laptop availability subscriptions",
              deleteSubscriptionsError,
            ),
          );
        }
      }
    }

    const { data: admins, error: adminsError } = await supabase
      .from("users")
      .select("id, mute_telegram")
      .eq("role", "admin");

    if (adminsError) {
      warnings.push(
        mutationError("Failed to load admin recipients", adminsError),
      );
    }

    const laptopNames = loan.laptop_loan_items
      .map((item) => item.laptops?.name)
      .filter(Boolean)
      .join(", ");
    const remarksLine = remarks ? `\nRemarks: ${remarks}` : "";

    if (admins?.length) {
      await insertRowsBestEffort({
        client: supabase,
        table: "notifications",
        entries: admins.map((admin) => ({
          user_id: admin.id,
          message: `Laptop loan #${id} [${laptopNames}] has been returned.${remarksLine}`,
          link: photoUrl,
        })),
        warnings,
        context: "admin return",
      });

      for (const admin of admins) {
        if (!admin.mute_telegram) {
          sendTelegramMessage(
            admin.id,
            `📥 <b>Laptop Returned</b>\nLoan #${id} [${laptopNames}] returned.${remarks ? `\n⚠️ ${remarks}` : ""}\n<a href="${photoUrl}">View Photo</a>`,
          ).catch(() => {});
        }
      }
    }

    return NextResponse.json(
      withWarnings(
        {
          message: "Laptop returned successfully!",
          photo_url: photoUrl,
        },
        warnings,
      ),
    );
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 },
    );
  }
}
