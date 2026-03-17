import { getDb, waitForSync, ensureUserExists, syncLoansToSheet, logActivity } from "@/lib/db/db";
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
    const { imageBase64 } = await request.json();
    if (!imageBase64) {
      return NextResponse.json({ error: "Photo is required to return items" }, { status: 400 });
    }

    const unawaitedParams = await params;
    const loanId = unawaitedParams.id;
    if (!loanId) {
      return NextResponse.json({ error: "Loan ID is required" }, { status: 400 });
    }

    await waitForSync();
    const db = getDb();
    ensureUserExists(user);

    // Verify loan belongs to user and is currently approved/temporary
    const loan = db.prepare("SELECT * FROM loan_requests WHERE id = ?").get(loanId);

    if (!loan) {
      return NextResponse.json({ error: "Loan not found" }, { status: 404 });
    }

    // Allow admins to use this endpoint to upload photos for users too
    if (loan.user_id !== user.id && user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized to return this loan" }, { status: 403 });
    }

    if (loan.status !== "approved" || loan.loan_type !== "temporary") {
      return NextResponse.json({ error: "Loan is not eligible for return" }, { status: 400 });
    }

    // Store photo in database and serve via /api/loans/[id]/photo
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
    const photoUrl = `${appUrl}/api/loans/${loanId}/photo`;

    // Update database — store base64 data and the public URL
    db.prepare(
      `UPDATE loan_requests SET status = 'returned', return_photo_url = ?, return_photo_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(photoUrl, imageBase64, loanId);

    // Notify admins
    const loanUser = db.prepare("SELECT display_name, username FROM users WHERE id = ?").get(loan.user_id);
    const activityDesc = `${loanUser?.display_name || 'A user'} returned loan #${loanId}. Photo: ${photoUrl}`;
    logActivity(db, user.id, "return", activityDesc);

    const admins = db.prepare("SELECT id FROM users WHERE role = 'admin'").all();
    const insertNotif = db.prepare("INSERT INTO notifications (user_id, message, link) VALUES (?, ?, ?)");
    for (const admin of admins) {
      insertNotif.run(
        admin.id,
        `${loanUser?.display_name || 'A user'} returned loan request #${loanId}. Click to view proof of return.`,
        `/loans`
      );
      sendTelegramMessage(
        admin.id,
        `📥 <b>Item Returned</b>\n${loanUser?.display_name} returned loan #${loanId}.\n<a href="${photoUrl}">View Proof Photo</a>`
      ).catch(() => {});
    }

    // Invalidate cache and sync to Google Sheets
    invalidateAll();
    await syncLoansToSheet();

    return NextResponse.json({ message: "Items returned successfully!", photo_url: `/api/loans/${loanId}/photo` });
  } catch (error) {
    console.error("Return loan error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
