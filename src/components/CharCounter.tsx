import { CARD_SIDE_MAX_LENGTH } from "@/lib/card-limits";
import { cn } from "@/lib/utils";

/** "120/150" under a card field. Turns red at the limit. */
export function CharCounter({
  length,
  max = CARD_SIDE_MAX_LENGTH,
  className,
}: {
  length: number;
  max?: number;
  className?: string;
}) {
  return (
    <span
      aria-live="polite"
      className={cn(
        "block text-right text-xs tabular-nums",
        length >= max ? "text-destructive" : "text-muted-foreground",
        className,
      )}
    >
      {length}/{max}
    </span>
  );
}
