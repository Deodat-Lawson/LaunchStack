"use client";

import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "~/components/ui/sheet";
import { cn } from "~/lib/utils";

/**
 * A side peek: a record or a task opened over the workspace, with the list
 * still in view behind it. Every detail surface in Growth is one of these
 * rather than a page of its own, so the way back is always a close.
 */
export function Panel({
    open,
    onOpenChange,
    title,
    description,
    size = "md",
    header,
    footer,
    children,
    className,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: React.ReactNode;
    description?: React.ReactNode;
    size?: "sm" | "md" | "lg";
    /** Extra header content under the title: actions, tabs, a stage control. */
    header?: React.ReactNode;
    footer?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                className={cn(
                    "flex w-full flex-col gap-0 p-0",
                    size === "sm" && "sm:max-w-[440px]",
                    size === "md" && "sm:max-w-[600px]",
                    size === "lg" && "sm:max-w-[760px]",
                    className
                )}
            >
                <SheetHeader className="border-line-2 shrink-0 gap-1 border-b px-6 pb-4 pt-6 text-left">
                    <SheetTitle className="text-ink pr-6 text-[17px] font-semibold tracking-[-0.01em]">
                        {title}
                    </SheetTitle>
                    {description && (
                        <SheetDescription className="text-ink-2 text-[13px]">
                            {description}
                        </SheetDescription>
                    )}
                    {header && <div className="mt-2">{header}</div>}
                </SheetHeader>
                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
                {footer && (
                    <div className="border-line-2 bg-panel shrink-0 border-t px-6 py-3">
                        {footer}
                    </div>
                )}
            </SheetContent>
        </Sheet>
    );
}
