import { supabase } from "@/lib/db/supabase";
import { getDb } from "@/lib/db/db";
import { getCurrentUser } from "@/lib/utils/auth";
import { NextResponse } from "next/server";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: templates } = await supabase
    .from("loan_templates")
    .select(`
      *,
      users (display_name)
    `)
    .order("order_idx", { ascending: true })
    .order("created_at", { ascending: false });

  return NextResponse.json({
    templates: (templates || []).map((t) => ({
      ...t,
      created_by_name: t.users?.display_name || null,
      items: JSON.parse(t.items_json || "[]"),
      users: undefined,
    })),
  });
}

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await request.json();
  const { action, id, name, description, loan_type, items, orderedIds } = body;

  if (action === "create" || action === "update") {
    if (!name || !name.trim()) {
      return NextResponse.json({ error: "Template name is required" }, { status: 400 });
    }
    if (!items || items.length === 0) {
      return NextResponse.json({ error: "At least one item is required" }, { status: 400 });
    }

    // Validate items exist in SQLite (inventory stays in SQLite)
    const db = getDb();
    for (const item of items) {
      const si = db.prepare("SELECT id FROM storage_items WHERE id = ?").get(item.item_id);
      if (!si) {
        return NextResponse.json({ error: `Item not found: ${item.item_id}` }, { status: 400 });
      }
    }

    const itemsJson = JSON.stringify(items);

    if (action === "create") {
      const { data: created, error } = await supabase
        .from("loan_templates")
        .insert({
          name: name.trim(),
          description: description || "",
          loan_type: loan_type || "temporary",
          items_json: itemsJson,
          created_by: user.id,
        })
        .select("id")
        .single();

      if (error) throw error;
      return NextResponse.json({ message: "Template created", id: created.id });
    } else {
      if (!id) return NextResponse.json({ error: "Template ID required" }, { status: 400 });
      await supabase
        .from("loan_templates")
        .update({ name: name.trim(), description: description || "", loan_type: loan_type || "temporary", items_json: itemsJson })
        .eq("id", id);

      return NextResponse.json({ message: "Template updated" });
    }
  }

  if (action === "delete") {
    if (!id) return NextResponse.json({ error: "Template ID required" }, { status: 400 });
    await supabase.from("loan_templates").delete().eq("id", id);
    return NextResponse.json({ message: "Template deleted" });
  }

  if (action === "reorder") {
    if (!Array.isArray(orderedIds)) {
      return NextResponse.json({ error: "orderedIds array required" }, { status: 400 });
    }

    await Promise.all(
      orderedIds.map((templateId, idx) =>
        supabase.from("loan_templates").update({ order_idx: idx }).eq("id", templateId),
      ),
    );

    return NextResponse.json({ message: "Templates reordered" });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
