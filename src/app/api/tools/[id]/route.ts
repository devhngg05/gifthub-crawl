import { eq, sql, type SQL } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import {
  SUB_CATEGORY_MAP,
  type CategorySlug,
  type SubCategorySlug,
} from "@/config/taxonomy";
import { db } from "@/db";
import { tools } from "@/db/schema";
import { verifyAdminSecret } from "@/lib/auth";
import { ToolIdParamSchema, ToolPatchSchema } from "@/lib/validator";

/**
 * Cá nhân hóa một công cụ theo `id`: cập nhật `isPinned`, `userNotes`, `subCategory`.
 * Khi đổi `subCategory`, tự động đồng bộ `category` và loại khỏi `secondarySubCategories`.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = verifyAdminSecret(request.headers.get("x-admin-secret"));
  if (!auth.authorized) {
    return NextResponse.json(
      { error: auth.error ?? "Unauthorized" },
      { status: auth.status },
    );
  }

  const { id: rawId } = await context.params;
  const parsedId = ToolIdParamSchema.safeParse(rawId);
  if (!parsedId.success) {
    return NextResponse.json(
      { error: "Invalid tool id", details: parsedId.error.flatten() },
      { status: 400 },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsedBody = ToolPatchSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Invalid request payload", details: parsedBody.error.flatten() },
      { status: 400 },
    );
  }

  const { isPinned, userNotes, subCategory } = parsedBody.data;
  const updateData: {
    isPinned?: boolean;
    userNotes?: string | null;
    subCategory?: SubCategorySlug;
    category?: CategorySlug;
    secondarySubCategories?: SQL<string[]>;
    updatedAt: Date;
  } = {
    updatedAt: new Date(),
  };

  if (isPinned !== undefined) {
    updateData.isPinned = isPinned;
  }
  if (userNotes !== undefined) {
    updateData.userNotes = userNotes;
  }
  if (subCategory !== undefined) {
    updateData.subCategory = subCategory;
    updateData.category = SUB_CATEGORY_MAP[subCategory].category;
    updateData.secondarySubCategories = sql<
      string[]
    >`array_remove(${tools.secondarySubCategories}, ${subCategory}::text)`;
  }

  try {
    const [updatedTool] = await db
      .update(tools)
      .set(updateData)
      .where(eq(tools.id, parsedId.data))
      .returning();

    if (!updatedTool) {
      return NextResponse.json({ error: "Tool not found" }, { status: 404 });
    }

    return NextResponse.json({ tool: updatedTool }, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown database error";
    console.error("[PATCH /api/tools/[id]] Database update failed:", message);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
