import { supabase } from "@/lib/db/supabase";
import { getCurrentUser } from "@/lib/utils/auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getCurrentUser();
    // All authenticated users need to read templates (for quick-borrow on inventory page)
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: templates, error: templatesError } = await supabase
      .from("loan_templates")
      .select(
        "id, name, description, loan_type, items_json, created_by, order_idx, created_at",
      )
      .order("order_idx", { ascending: true })
      .order("created_at", { ascending: false });

    if (templatesError) {
      throw new Error(templatesError.message || "Failed to load templates");
    }

    const createdByIds = [
      ...new Set(
        (templates || [])
          .map((template) => template.created_by)
          .filter(Boolean),
      ),
    ];
    let usersById = new Map();

    if (createdByIds.length > 0) {
      const { data: users, error: usersError } = await supabase
        .from("users")
        .select("id, display_name")
        .in("id", createdByIds);

      if (usersError) {
        throw new Error(
          usersError.message || "Failed to load template authors",
        );
      }

      usersById = new Map((users || []).map((entry) => [entry.id, entry]));
    }

    return NextResponse.json({
      templates: (templates || []).map((template) => {
        let parsedItems = [];
        try {
          parsedItems = JSON.parse(template.items_json || "[]");
          if (!Array.isArray(parsedItems)) parsedItems = [];
        } catch {
          parsedItems = [];
        }

        return {
          ...template,
          created_by_name:
            usersById.get(template.created_by)?.display_name || null,
          items: parsedItems,
        };
      }),
    });
  } catch (error) {
    console.error("Templates GET error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to load templates" },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== "admin") {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 },
      );
    }

    const body = await request.json();
    const { action, id, name, description, loan_type, items, orderedIds } =
      body;

    if (action === "create" || action === "update") {
      if (!name || !name.trim()) {
        return NextResponse.json(
          { error: "Template name is required" },
          { status: 400 },
        );
      }
      if (!items || items.length === 0) {
        return NextResponse.json(
          { error: "At least one item is required" },
          { status: 400 },
        );
      }

      const { getDb } = await import("@/lib/db/db");
      const db = getDb();
      for (const item of items) {
        const existing = db
          .prepare("SELECT id FROM storage_items WHERE id = ?")
          .get(item.item_id);
        if (!existing) {
          return NextResponse.json(
            { error: `Item not found: ${item.item_id}` },
            { status: 400 },
          );
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
        return NextResponse.json({
          message: "Template created",
          id: created.id,
        });
      }

      if (!id) {
        return NextResponse.json(
          { error: "Template ID required" },
          { status: 400 },
        );
      }

      const { error: updateError } = await supabase
        .from("loan_templates")
        .update({
          name: name.trim(),
          description: description || "",
          loan_type: loan_type || "temporary",
          items_json: itemsJson,
        })
        .eq("id", id);

      if (updateError) throw updateError;
      return NextResponse.json({ message: "Template updated" });
    }

    if (action === "delete") {
      if (!id) {
        return NextResponse.json(
          { error: "Template ID required" },
          { status: 400 },
        );
      }

      const { error: deleteError } = await supabase
        .from("loan_templates")
        .delete()
        .eq("id", id);

      if (deleteError) throw deleteError;
      return NextResponse.json({ message: "Template deleted" });
    }

    if (action === "reorder") {
      if (!Array.isArray(orderedIds)) {
        return NextResponse.json(
          { error: "orderedIds array required" },
          { status: 400 },
        );
      }

      const results = await Promise.all(
        orderedIds.map((templateId, idx) =>
          supabase
            .from("loan_templates")
            .update({ order_idx: idx })
            .eq("id", templateId),
        ),
      );

      const failed = results.find((result) => result.error);
      if (failed?.error) throw failed.error;

      return NextResponse.json({ message: "Templates reordered" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Templates POST error:", error);
    return NextResponse.json(
      { error: error.message || "Template action failed" },
      { status: 500 },
    );
  }
}
