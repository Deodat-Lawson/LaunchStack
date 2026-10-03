import { cn } from "~/lib/utils";

/**
 * The Vantage mark: a ridge line with the sun above it — a high place to see
 * the week from. Drawn on a 24-unit grid; strokes stay 1.75 at every size so
 * it reads at 16px in a rail and at 40px on an empty state.
 *
 * `tile` paints it in the accent on a rounded square, the way the app's own
 * mark sits in the Studio rail. Without `tile` it inherits `currentColor`,
 * which is how the Studio registry uses it as an icon.
 */
export function VantageMark({
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
            <path
                d="M3 18.5 L9.5 8.5 L13.5 14 L16 11 L21 18.5"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path d="M3 18.5 H21" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            <circle cx="17.5" cy="6" r="1.9" fill="currentColor" />
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

/** Registry-shaped icon: same props as the other Studio icons. */
export function IconVantage({ size = 18, className }: { size?: number; className?: string }) {
    return <VantageMark size={size} className={className} />;
}
