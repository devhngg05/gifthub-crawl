import "./load-env";

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { db } from "@/db";
import { sanitizeErrorMessage } from "@/lib/sanitize-error";
import { runSync } from "./lib/sync/runner";

export * from "./lib/sync/upsert";
export * from "./lib/sync/reclassify";
export * from "./lib/sync/lock";
export * from "./lib/sync/prune";
export * from "./lib/sync/runner";
export { sanitizeErrorMessage };

/** Kiểm tra file có đang được chạy trực tiếp qua CLI hay chỉ được import làm module. */
export function isDirectExecution(
  argv1: string | undefined,
  moduleUrl: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (!argv1 || argv1.trim().length === 0) {
    return false;
  }

  try {
    const entryHref = pathToFileURL(path.resolve(argv1)).href;
    const moduleHref = pathToFileURL(
      path.resolve(fileURLToPath(moduleUrl)),
    ).href;

    if (platform === "win32") {
      return entryHref.toLowerCase() === moduleHref.toLowerCase();
    }
    return entryHref === moduleHref;
  } catch {
    return false;
  }
}

if (isDirectExecution(process.argv[1], import.meta.url)) {
  runSync({ db }).catch((error: unknown) => {
    console.error(`[sync-tools] Fatal error: ${sanitizeErrorMessage(error)}`);
    process.exitCode = 1;
  });
}
