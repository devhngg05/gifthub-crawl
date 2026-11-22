"use client";

import { useSyncExternalStore } from "react";
import { formatIsoDate, formatRelativeTimeVi } from "@/lib/ui-helpers";

export interface RelativeTimeProps {
  isoDate: string;
  className?: string;
}

const emptySubscribe = () => () => {};

/**
 * Hiển thị `YYYY-MM-DD` ổn định trong SSR/hydration lần đầu,
 * sau đó chuyển sang mốc thời gian tương đối tiếng Việt trên client để tránh Hydration Mismatch.
 */
export function RelativeTime({ isoDate, className }: RelativeTimeProps) {
  const isClient = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  const fallbackDate = formatIsoDate(isoDate);
  const label = isClient ? formatRelativeTimeVi(isoDate) : fallbackDate;

  return (
    <time dateTime={isoDate} title={isoDate} className={className}>
      {label}
    </time>
  );
}
