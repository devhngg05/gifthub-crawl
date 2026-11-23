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
import { sanitizeErrorMessage } from "@/lib/sanitize-error";
import { buildToolSearchText } from "@/lib/search-engine";
import { ToolIdParamSchema, ToolPatchSchema } from "@/lib/validator";

/**
 * Cá nhân hóa một công cụ theo `id`: cập nhật `isPinned`, `userNotes`, `subCategory`.
 * Khi đổi `subCategory` hoặc `userNotes`, tự động đồng bộ `category`, loại khỏi `secondarySubCategories` và tính lại `searchText`.
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
    searchText?: string;
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
    if (subCategory !== undefined || userNotes !== undefined) {
      const [existingTool] = await db
        .select({
          name: tools.name,
          fullName: tools.fullName,
          language: tools.language,
          summaryVi: tools.summaryVi,
          category: tools.category,
          subCategory: tools.subCategory,
          secondarySubCategories: tools.secondarySubCategories,
          useCases: tools.useCases,
          replaces: tools.replaces,
          userNotes: tools.userNotes,
        })
        .from(tools)
        .where(eq(tools.id, parsedId.data))
        .limit(1);

      if (!existingTool) {
        return NextResponse.json({ error: "Tool not found" }, { status: 404 });
      }

      const nextSubCategory = subCategory ?? existingTool.subCategory;
      const nextCategory = subCategory
        ? SUB_CATEGORY_MAP[subCategory].category
        : existingTool.category;
      const nextSecondary = subCategory
        ? existingTool.secondarySubCategories.filter((s) => s !== subCategory)
        : existingTool.secondarySubCategories;
      const nextUserNotes =
        userNotes !== undefined ? userNotes : existingTool.userNotes;

      updateData.searchText = buildToolSearchText({
        name: existingTool.name,
        fullName: existingTool.fullName,
        language: existingTool.language,
        summaryVi: existingTool.summaryVi,
        category: nextCategory,
        subCategory: nextSubCategory,
        secondarySubCategories: nextSecondary,
        useCases: existingTool.useCases,
        replaces: existingTool.replaces,
        userNotes: nextUserNotes,
      });
    }

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
    const safeMessage = sanitizeErrorMessage(error);
    console.error("[PATCH /api/tools/[id]] Database update failed:", safeMessage);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
