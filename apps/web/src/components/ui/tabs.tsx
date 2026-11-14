"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "~/lib/utils";

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
    return (
        <TabsPrimitive.Root
            data-slot="tabs"
            className={cn("flex flex-col gap-2", className)}
            {...props}
        />
    );
}

/**
 * "pill" is the segmented control; "line" is a row of tabs on a hairline, the
 * current one underlined, for the views of one page.
 */
type TabsVariant = "pill" | "line";
const VariantContext = React.createContext<TabsVariant>("pill");

function TabsList({
    className,
    variant = "pill",
    ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & { variant?: TabsVariant }) {
    return (
        <VariantContext.Provider value={variant}>
            <TabsPrimitive.List
                data-slot="tabs-list"
                data-variant={variant}
                className={cn(
                    variant === "line"
                        ? "border-line text-ink-3 flex h-auto w-full items-end gap-6 overflow-x-auto border-b [scrollbar-width:none]"
                        : "bg-panel-2 text-ink-3 flex inline-flex h-9 w-fit items-center justify-center rounded-xl p-[3px]",
                    className
                )}
                {...props}
            />
        </VariantContext.Provider>
    );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
    const variant = React.useContext(VariantContext);
    if (variant === "line") {
        return (
            <TabsPrimitive.Trigger
                data-slot="tabs-trigger"
                className={cn(
                    "text-ink-3 hover:text-ink data-[state=active]:text-ink focus-visible:ring-brand/50 inline-flex shrink-0 items-baseline gap-1.5 whitespace-nowrap rounded-none pb-2.5 pt-1.5 text-sm font-medium outline-none transition-colors focus-visible:rounded-sm focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:shadow-[inset_0_-2px_0_var(--ink)] [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
                    className
                )}
                {...props}
            />
        );
    }
    return (
        <TabsPrimitive.Trigger
            data-slot="tabs-trigger"
            className={cn(
                "data-[state=active]:bg-panel dark:data-[state=active]:text-ink focus-visible:border-brand focus-visible:ring-brand/50 focus-visible:outline-brand dark:data-[state=active]:border-line dark:data-[state=active]:bg-line/30 text-ink dark:text-ink-3 inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-transparent px-2 py-1 text-sm font-medium transition-[color,box-shadow] focus-visible:outline-1 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
                className
            )}
            {...props}
        />
    );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
    return (
        <TabsPrimitive.Content
            data-slot="tabs-content"
            className={cn("flex-1 outline-none", className)}
            {...props}
        />
    );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
