import { getDb, waitForSync } from "@/lib/db/db";
import { NextResponse } from "next/server";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Loan ID is required" }, { status: 400 });
    }

    await waitForSync();
    const db = getDb();

    const loan = db.prepare("SELECT return_photo_data FROM loan_requests WHERE id = ?").get(id);

    if (!loan || !loan.return_photo_data) {
      return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    }

    const base64Data = loan.return_photo_data;

    // Extract mime type and raw base64
    let mimeType = "image/jpeg";
    let rawBase64 = base64Data;

    if (base64Data.startsWith("data:")) {
      const parts = base64Data.split(";base64,");
      mimeType = parts[0].replace("data:", "");
      rawBase64 = parts[1];
    }

    const buffer = Buffer.from(rawBase64, "base64");

    return new Response(buffer, {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("Serve return photo error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
