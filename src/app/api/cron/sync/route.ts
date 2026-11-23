import { NextRequest, NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/auth";
import { sanitizeErrorMessage } from "@/lib/sanitize-error";
import { buildCronSyncOptions } from "../../../../../scripts/lib/sync/cron-config";
import { runSync } from "../../../../../scripts/lib/sync/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

async function handleCronSync(request: NextRequest): Promise<NextResponse> {
  const auth = verifyCronRequest(request);
  if (!auth.authorized) {
    return NextResponse.json(
      { ok: false, error: auth.error ?? "Unauthorized" },
      { status: auth.status, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const summary = await runSync(buildCronSyncOptions(process.env));
    if (summary.skippedDueToLock) {
      return NextResponse.json(
        { ok: true, skipped: true, reason: "lock_held", summary },
        { status: 200, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json(
      { ok: true, skipped: false, summary },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error("[cron/sync] Sync failed:", sanitizeErrorMessage(error));
    return NextResponse.json(
      { ok: false, error: "Sync execution failed" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleCronSync(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleCronSync(request);
}
