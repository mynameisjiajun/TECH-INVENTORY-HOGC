import { supabase } from "@/lib/db/supabase";
import { getCurrentUser } from "@/lib/utils/auth";
import { invalidateAll } from "@/lib/utils/cache";
import { sendTelegramMessage, sendChannelMessage } from "@/lib/services/telegram";
import { sendLaptopAvailableEmail, sendLoanReturnEmail } from "@/lib/services/email";
import { escapeHtml, isSafeHttpsUrl } from "@/lib/utils/html";
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
      .select("*, laptop_loan_items(laptop_id, laptops(name, cpu))")
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
    const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g, "");
    const fileName = `laptop-loan-${safeId}-${Date.now()}.jpg`;

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
      .update({
        status: "returned",
        return_photo_url: photoUrl,
        updated_at: new Date().toISOString(),
      })
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
    if (loan.loan_type === "permanent" && laptopIds.length > 0) {
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
          .update({
            status: loan.status,
            return_photo_url: loan.return_photo_url || null,
            updated_at: loan.updated_at || null,
          })
          .eq("id", id);
        await deleteStorageObjectBestEffort({
          bucket: photoBucket,
          path: fileName,
          warnings,
          context: "uploaded return photo",
        });
        return NextResponse.json(
          {
            error: mutationError(
              "Failed to release permanent laptop assignment",
              releasePermanentError,
            ),
            details: warnings,
          },
          { status: 500 },
        );
      }
    }

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
            `💻 <b>Laptop Available!</b>\n<b>${escapeHtml(laptopName)}</b> is now available to borrow.\n\nHead to the app to reserve it!`,
          ).catch((err) => console.error("laptop avail telegram failed:", err?.message || err));
        }
        if (subUser.email && !subUser.mute_emails) {
          sendLaptopAvailableEmail({
            to: subUser.email,
            displayName: subUser.display_name,
            laptopName,
          }).catch((err) => console.error("laptop return notification send failed:", err?.message || err));
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
      .map((item) => escapeHtml(item.laptops?.name || ""))
      .filter(Boolean)
      .join(", ");
    const rawLaptopNames = loan.laptop_loan_items
      .map((item) => item.laptops?.name)
      .filter(Boolean)
      .join(", ");
    const remarksLine = remarks ? `\nRemarks: ${remarks}` : "";
    const safeRemarks = remarks ? escapeHtml(remarks) : "";
    const photoAnchor = isSafeHttpsUrl(photoUrl)
      ? `<a href="${escapeHtml(photoUrl)}">View Photo</a>`
      : "Photo uploaded";
    const userPhotoAnchor = isSafeHttpsUrl(photoUrl)
      ? `<a href="${escapeHtml(photoUrl)}">View Your Return Photo</a>`
      : "Return photo uploaded";

    if (admins?.length) {
      await insertRowsBestEffort({
        client: supabase,
        table: "notifications",
        entries: admins.map((admin) => ({
          user_id: admin.id,
          message: `Laptop loan #${id} [${rawLaptopNames}] has been returned.${remarksLine}`,
          link: photoUrl,
        })),
        warnings,
        context: "admin return",
      });

      for (const admin of admins) {
        if (!admin.mute_telegram) {
          sendTelegramMessage(
            admin.id,
            `📥 <b>Laptop Returned</b>\nLoan #${id} [${laptopNames}] returned.${safeRemarks ? `\n⚠️ ${safeRemarks}` : ""}\n${photoAnchor}`,
          ).catch((err) => console.error("laptop return admin telegram failed:", err?.message || err));
        }
      }
    }

    // Send return receipt to borrower
    sendTelegramMessage(
      loan.user_id,
      `✅ <b>Return Received!</b>\nYour laptop return for loan #${id} [${laptopNames}] has been recorded.${safeRemarks ? `\n⚠️ <b>Remarks:</b> ${safeRemarks}` : ""}\n📸 ${userPhotoAnchor}`,
    ).catch((err) => console.error("laptop return user telegram failed:", err?.message || err));

    await insertRowsBestEffort({
      client: supabase,
      table: "notifications",
      entries: [
        {
          user_id: loan.user_id,
          message: `Your laptop return for loan #${id} has been received and recorded.`,
          link: "/loans",
        },
      ],
      warnings,
      context: "user laptop return receipt",
    });

    const { data: loanUserRecord } = await supabase
      .from("users")
      .select("email, display_name, telegram_handle, mute_emails")
      .eq("id", loan.user_id)
      .single();

    if (loanUserRecord?.email && !loanUserRecord?.mute_emails) {
      sendLoanReturnEmail({
        to: loanUserRecord.email,
        displayName: loanUserRecord.display_name,
        loanId: id,
        items: loan.laptop_loan_items.map((item) => ({
          item: item.laptops?.name || "Laptop",
          quantity: 1,
        })),
        photoUrl,
        adminReturn: false,
      }).catch((err) => console.error("laptop return notification send failed:", err?.message || err));
    }

    const formatReturnDate = (dateStr) => {
      if (!dateStr) return "N/A";
      const [year, month, day] = dateStr.split("-").map(Number);
      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return `${day} ${months[month - 1]} ${year}`;
    };

    const returnChannelItems = loan.laptop_loan_items.map((item) => {
      const name = escapeHtml(item.laptops?.name || "Unknown");
      const cpu = item.laptops?.cpu ? ` (${escapeHtml(item.laptops.cpu)})` : "";
      return `${name}${cpu}`;
    });
    const returnLaptopLabel = returnChannelItems.length > 1 ? "Laptops" : "Laptop";
    const returnLaptopBlock = returnChannelItems.length === 1
      ? `<b>${returnLaptopLabel}:</b> ${returnChannelItems[0]}`
      : `<b>${returnLaptopLabel}:</b>\n${returnChannelItems.map((l) => `• ${l}`).join("\n")}`;
    const returnBorrowerName = escapeHtml(loanUserRecord?.display_name || "Unknown");
    const returnBorrowerHandle = loanUserRecord?.telegram_handle
      ? `@${escapeHtml(loanUserRecord.telegram_handle.replace(/^@/, ""))}`
      : "no handle";
    const returnDepartment = loan.department
      ? `${escapeHtml(loan.department.toUpperCase())} Ministry`
      : "N/A";

    sendChannelMessage(
      `📥 <b>LAPTOP RETURNED</b>\n<i>Returned by <b>${returnBorrowerName}</b> (${returnBorrowerHandle}) from ${returnDepartment}</i>\n──────────────────\n<b>Loan ID:</b> #${id}\n\n${returnLaptopBlock}\n<b>Return Date:</b> ${formatReturnDate(new Date().toISOString().slice(0, 10))}${safeRemarks ? `\n<b>Remarks:</b> ${safeRemarks}` : ""}`,
    ).catch((err) => console.error("laptop return channel telegram failed:", err?.message || err));

    invalidateAll();

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
