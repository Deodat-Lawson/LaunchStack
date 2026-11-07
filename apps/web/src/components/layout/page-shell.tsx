import { type CSSProperties, type ReactNode } from "react";
import { cn } from "~/lib/utils";

/**
 * Page scaffolding for application screens: a readable max-width column
 * on the token background. Successor to the deprecated inline-style
 * primitives — same API, Tailwind + design tokens underneath.
 *
 * Pass `embedded` when rendering inside a bounded container (e.g. the
 * Studio drawer): swaps `min-h-screen` for `h-full` so the shell fills
 * its flex parent instead of forcing a viewport-height scroll, and
 * tightens the outer padding to match the pane chrome.
 */
export function PageShell({
    children,
    wide = false,
    embedded = false,
    className,
    style,
}: {
    children: ReactNode;
    wide?: boolean;
    embedded?: boolean;
    className?: string;
    style?: CSSProperties;
}) {
    return (
        <div
            className={cn(
                "bg-surface text-ink flex flex-col",
                embedded ? "h-full overflow-y-auto" : "min-h-screen",
                className
            )}
            style={style}
        >
            <main
                className={cn(
                    "mx-auto w-full flex-1",
                    wide ? "max-w-[1200px]" : "max-w-[840px]",
                    embedded ? "px-6 pb-12 pt-5" : "px-6 pb-20 pt-8"
                )}
            >
                {children}
            </main>
        </div>
    );
}

/**
 * The page's title block. No kicker above the title: the heading carries its
 * own weight, and the breadcrumb already says where you are.
 */
export function PageHeader({
    title,
    description,
    actions,
}: {
    title: string;
    description?: string;
    actions?: ReactNode;
}) {
    return (
        <div className="mb-7 flex flex-wrap items-start gap-x-4 gap-y-3">
            <div className="min-w-[min(100%,280px)] flex-1">
                <h1 className="display text-ink @max-sm:text-[28px] m-0 text-[34px] leading-[1.1] tracking-tight">
                    {title}
                </h1>
                {description && (
                    <div className="text-ink-3 mt-1.5 max-w-[68ch] text-sm leading-relaxed">
                        {description}
                    </div>
                )}
            </div>
            {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
    );
}

export function Section({
    title,
    description,
    children,
}: {
    title?: string;
    description?: string;
    children: ReactNode;
}) {
    return (
        <section className="mb-8">
            {title && (
                <div className="mb-4">
                    <h2 className="text-ink m-0 text-base font-bold tracking-[-0.01em]">{title}</h2>
                    {description && (
                        <div className="text-ink-3 mt-1 text-[13px] leading-normal">
                            {description}
                        </div>
                    )}
                </div>
            )}
            {children}
        </section>
    );
}

/**
 * Plain panel card: token surface, hairline border, free-form padding.
 * (The structured shadcn Card in ~/components/ui/card stays the choice
 * for header/content/footer compositions.)
 */
export function Card({
    children,
    padding = 20,
    className,
    style,
}: {
    children: ReactNode;
    padding?: number | string;
    className?: string;
    style?: CSSProperties;
}) {
    return (
        <div
            className={cn("border-line bg-panel rounded-[14px] border", className)}
            style={{ padding, ...style }}
        >
            {children}
        </div>
    );
}
