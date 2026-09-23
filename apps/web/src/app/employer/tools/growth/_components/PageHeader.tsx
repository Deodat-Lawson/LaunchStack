import { cn } from "~/lib/utils";

/**
 * The one display line per screen. `accent` is the phrase set in the brand
 * colour, the way the Studio's "What do you want to *ask* yourself?" does
 * it — same typeface, emphasis by colour.
 */
export function PageHeader({
    title,
    accent,
    sub,
    actions,
    size = "lg",
    className,
}: {
    title: string;
    accent?: string;
    sub?: React.ReactNode;
    actions?: React.ReactNode;
    size?: "lg" | "md";
    className?: string;
}) {
    return (
        <header
            className={cn("grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end", className)}
        >
            <div className="min-w-0">
                <h1
                    className={cn(
                        "display text-ink text-balance leading-[1.1] tracking-[-0.02em]",
                        size === "lg" ? "text-[28px] md:text-[30px]" : "text-[24px] md:text-[26px]"
                    )}
                >
                    {title}
                    {accent && (
                        <>
                            {" "}
                            <em className="text-brand-ink">{accent}</em>
                        </>
                    )}
                </h1>
                {sub && <div className="text-ink-3 mt-1.5 text-[13px]">{sub}</div>}
            </div>
            {actions && (
                <div className="flex flex-wrap items-center gap-2 md:justify-end">{actions}</div>
            )}
        </header>
    );
}

export function SectionHeading({
    title,
    aside,
    className,
}: {
    title: string;
    aside?: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={cn("mb-2 flex items-baseline justify-between gap-3", className)}>
            <h2 className="text-ink text-[13px] font-semibold">{title}</h2>
            {aside && <span className="text-ink-3 text-xs">{aside}</span>}
        </div>
    );
}
