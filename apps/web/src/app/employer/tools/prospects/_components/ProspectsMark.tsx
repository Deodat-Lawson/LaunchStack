import { cn } from "~/lib/utils";

/**
 * The Prospects mark: two thin rings with their overlap filled. The overlap
 * is the point of the product — the companies that are both out there and a
 * fit for what you sell. Drawn on a 24-unit grid; strokes stay 1.75 at every
 * size so it reads at 16px in the rail and at 40px on an empty state.
 *
 * `tile` paints it in the accent on a rounded square, the way the app's own
 * mark sits in the Studio rail. Without `tile` it inherits `currentColor`.
 */
export function ProspectsMark({
    size = 20,
    tile = false,
    className,
}: {
    size?: number;
    tile?: boolean;
    className?: string;
}) {
    const glyph = (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            focusable="false"
        >
            <circle cx="9.5" cy="12" r="6" stroke="currentColor" strokeWidth="1.75" />
            <circle cx="14.5" cy="12" r="6" stroke="currentColor" strokeWidth="1.75" />
            <path d="M12 6.55 A6 6 0 0 1 12 17.45 A6 6 0 0 1 12 6.55 Z" fill="currentColor" />
        </svg>
    );
    if (!tile) return <span className={cn("inline-flex", className)}>{glyph}</span>;
    return (
        <span
            className={cn(
                "bg-brand text-brand-fg inline-flex shrink-0 items-center justify-center rounded-[27%]",
                className
            )}
            style={{ width: size * 1.4, height: size * 1.4 }}
        >
            {glyph}
        </span>
    );
}

export function ProspectsWordmark({ className }: { className?: string }) {
    return (
        <span className={cn("inline-flex items-center gap-2", className)}>
            <ProspectsMark size={15} tile />
            <span className="text-ink text-[13.5px] font-semibold tracking-[-0.02em]">
                Prospects
            </span>
        </span>
    );
}
