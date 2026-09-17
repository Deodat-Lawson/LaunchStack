"use client";

import * as React from "react";
import * as TogglePrimitive from "@radix-ui/react-toggle";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

const toggleVariants = cva(
    "hover:bg-panel-2 hover:text-ink focus-visible:ring-brand/50 data-[state=on]:bg-panel-2 data-[state=on]:text-ink outline-hidden inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
    {
        variants: {
            variant: {
                default: "bg-transparent text-ink-2",
                outline: "border-line hover:bg-panel-2 border bg-transparent text-ink-2",
            },
            size: {
                default: "h-9 min-w-9 px-2",
                sm: "h-8 min-w-8 px-1.5",
                lg: "h-10 min-w-10 px-2.5",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    }
);

function Toggle({
    className,
    variant,
    size,
    ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>) {
    return (
        <TogglePrimitive.Root
            data-slot="toggle"
            className={cn(toggleVariants({ variant, size, className }))}
            {...props}
        />
    );
}

export { Toggle, toggleVariants };
