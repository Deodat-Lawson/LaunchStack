import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

const badgeVariants = cva(
    "inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-brand focus-visible:ring-brand/50 focus-visible:ring-[3px] aria-invalid:ring-danger/20 dark:aria-invalid:ring-danger/40 aria-invalid:border-danger transition-[color,box-shadow] overflow-hidden",
    {
        variants: {
            variant: {
                default: "border-transparent bg-brand text-brand-fg [a&]:hover:bg-brand/90",
                secondary: "border-transparent bg-panel-2 text-ink-2 [a&]:hover:bg-panel-2/90",
                destructive:
                    "border-transparent bg-danger text-white [a&]:hover:bg-danger/90 focus-visible:ring-danger/20 dark:focus-visible:ring-danger/40 dark:bg-danger/60",
                outline: "text-ink [a&]:hover:bg-brand-soft [a&]:hover:text-brand-ink",
                success: "border-transparent bg-success-soft text-success",
                warn: "border-transparent bg-warn-soft text-warn",
                info: "border-transparent bg-info-soft text-info",
            },
        },
        defaultVariants: {
            variant: "default",
        },
    }
);

function Badge({
    className,
    variant,
    asChild = false,
    ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
    const Comp = asChild ? Slot : "span";

    return (
        <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
    );
}

export { Badge, badgeVariants };
