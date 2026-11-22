import { NextRequest, NextResponse } from "next/server";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  void request;
  await context.params;
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
