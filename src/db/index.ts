import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type * as schema from "./schema";

export type DatabaseClient = NeonHttpDatabase<typeof schema>;

export function sanitizeDatabaseUrl(url: string): string {
  return url;
}
