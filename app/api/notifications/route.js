import { getDb, ensureUserExists } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function GET() {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  ensureUserExists(user);
  const notifications = db
    .prepare(
      "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20",
    )
    .all(user.id);

  const unreadCount = db
    .prepare(
      "SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = 0",
    )
    .get(user.id).count;

  return NextResponse.json({ notifications, unreadCount });
}

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { action, notification_id } = await request.json();
  const db = getDb();

  if (action === "read") {
    if (!notification_id || !Number.isInteger(Number(notification_id))) {
      return NextResponse.json(
        { error: "Valid notification_id is required" },
        { status: 400 },
      );
    }
    db.prepare(
      "UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?",
    ).run(notification_id, user.id);
  } else if (action === "read_all") {
    db.prepare("UPDATE notifications SET read = 1 WHERE user_id = ?").run(
      user.id,
    );
  }

  return NextResponse.json({ ok: true });
}
