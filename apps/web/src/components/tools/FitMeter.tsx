import { useTranslations } from "next-intl";

import { cn } from "~/lib/utils";

/**
 * Fit as a short meter in ink, with the number beside it. The accent appears
 * only above the segment's threshold, so a glance at a list shows which rows
 * cleared the bar without turning every score into a traffic light.
 */
export function FitMeter({
    value,
    threshold = 70,
    label,
    className,
}: {
    value: number | null;
    threshold?: number;
    /** Prefix the number, e.g. "Fit" on a company header. */
    label?: string;
    className?: string;
}) {
    const t = useTranslations("tools.fitMeter");
    if (value === null) {
        return (
            <span className={cn("text-ink-3 text-xs", className)} title={t("notScored")}>
                {label ? `${label} —` : "—"}
            </span>
        );
    }
    const clamped = Math.max(0, Math.min(100, value));
    const high = clamped >= threshold;
    return (
        <span
            className={cn("inline-grid grid-cols-[44px_auto] items-center gap-2", className)}
            title={
                high
                    ? t("title", { value: clamped })
                    : t("titleBelowThreshold", { value: clamped, threshold })
            }
            aria-label={t("label", { value: clamped })}
        >
            <span className="bg-line relative block h-1.5 overflow-hidden rounded-full">
                <span
                    className={cn(
                        "absolute inset-y-0 left-0 rounded-full transition-[width] duration-200 motion-reduce:transition-none",
                        high ? "bg-brand" : "bg-ink-2"
                    )}
                    style={{ width: `${clamped}%` }}
                />
            </span>
            <span className="text-ink text-xs font-medium tabular-nums">
                {label ? `${label} ` : ""}
                {clamped}
            </span>
        </span>
    );
}
