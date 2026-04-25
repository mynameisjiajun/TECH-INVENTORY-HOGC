import { supabase } from "@/lib/db/supabase";
import { getCurrentUser } from "@/lib/utils/auth";
import { NextResponse } from "next/server";

// Redirect to the stored return photo URL (Supabase Storage or ImgBB).
// Kept as a stable endpoint so old Telegram links continue to work.
export async function GET(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Loan ID is required" }, { status: 400 });

    const { data: loan } = await supabase
      .from("loan_requests")
      .select("return_photo_url, user_id")
      .eq("id", id)
      .maybeSingle();

    if (!loan || !loan.return_photo_url) {
      return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    }

    // Only the loan owner or an admin may view the photo
    if (Number(loan.user_id) !== Number(user.id) && user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.redirect(loan.return_photo_url, { status: 302 });
  } catch (error) {
    console.error("Serve return photo error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
