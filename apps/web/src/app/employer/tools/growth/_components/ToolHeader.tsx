import { cn } from "~/lib/utils";

/**
 * The header every tool page in this app opens with: an icon tile, the
 * tool's name, one line on what it does, and the page's actions on the
 * right. Same shape as the repo explainer and the email workspace, so Growth
 * reads as one of the tools rather than an app of its own.
 */
export function ToolHeader({
    icon,
    title,
    description,
    actions,
    className,
}: {
    icon: React.ReactNode;
    title: React.ReactNode;
    description?: React.ReactNode;
    actions?: React.ReactNode;
    className?: string;
}) {
    return (
        <header
            className={cn(
                "flex flex-col gap-3 md:flex-row md:items-center md:justify-between",
                className
            )}
        >
            <div className="flex min-w-0 items-center gap-3">
                <div
                    className="bg-brand/10 text-brand-ink dark:bg-brand/15 flex size-10 shrink-0 items-center justify-center rounded-2xl"
                    aria-hidden
                >
                    {icon}
                </div>
                <div className="min-w-0">
                    <h1 className="text-ink truncate text-lg font-semibold tracking-tight md:text-xl">
                        {title}
                    </h1>
                    {description && <p className="text-ink-3 text-xs md:text-sm">{description}</p>}
                </div>
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
    );
}

/** The page body under a ToolHeader: one column, the tool's width, room at the bottom. */
export function ToolPage({
    children,
    width = "wide",
    className,
}: {
    children: React.ReactNode;
    width?: "wide" | "reading";
    className?: string;
}) {
    return (
        <main
            className={cn(
                "mx-auto flex w-full flex-1 flex-col gap-5 px-4 pb-12 pt-6 md:px-6",
                width === "wide" ? "max-w-[1440px]" : "max-w-5xl",
                className
            )}
        >
            {children}
        </main>
    );
}
