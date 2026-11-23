import { Star } from "lucide-react";
import type { QualityRating } from "@/lib/newsfeed";

export interface QualityStarsProps {
  rating: QualityRating;
  size?: "sm" | "xs";
}

/**
 * Huy hiệu Ngôi sao chất lượng (1–3 sao vàng tô đặc kèm tooltip giải thích lý do).
 * Trả về `null` khi `tier === 0` để giữ sự chọn lọc và tối giản trên giao diện.
 */
export function QualityStars({ rating, size = "sm" }: QualityStarsProps) {
  if (rating.tier === 0) {
    return null;
  }

  const tooltip =
    rating.reasons.length > 0
      ? `${rating.label} — ${rating.reasons.join(" · ")}`
      : rating.label;

  const iconClass =
    size === "xs"
      ? "h-2.5 w-2.5 fill-amber-400 text-amber-400"
      : "h-3 w-3 fill-amber-400 text-amber-400";

  return (
    <span
      title={tooltip}
      aria-label={tooltip}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5"
    >
      {Array.from({ length: rating.tier }).map((_, index) => (
        <Star key={index} className={iconClass} aria-hidden="true" />
      ))}
    </span>
  );
}
