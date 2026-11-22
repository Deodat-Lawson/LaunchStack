import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

/**
 * A notice inside a screen: one or two sentences about the state of things,
 * with an optional action. Same tones as `Badge` — soft fill, status ink —
 * so a warning reads the same as a chip and a callout.
 *
 * For a failed load with a retry, `InlineError` (~/components/tools/EmptyState)
 * is lighter; for a result of something the person just did, a toast.
 */
const alertVariants = cva(
    // Two columns always — an empty one when there is no icon — so the title
    // and description sit in column 2 whatever the caller puts first.
    "relative grid w-full grid-cols-[0_minmax(0,1fr)] items-start gap-y-0.5 rounded-lg border px-4 py-3 text-[13px] leading-normal has-[>svg]:grid-cols-[16px_minmax(0,1fr)] has-[>svg]:gap-x-2.5 [&>svg]:size-4 [&>svg]:translate-y-px",
    {
        variants: {
            variant: {
                default: "border-line bg-panel-2 text-ink-2 [&>svg]:text-ink-3",
                info: "border-info/30 bg-info-soft text-info-ink",
                success: "border-success/30 bg-success-soft text-success-ink",
                warn: "border-warn/40 bg-warn-soft text-warn-ink",
                danger: "border-danger/30 bg-danger-soft text-danger-ink",
            },
        },
        defaultVariants: {
            variant: "default",
        },
    }
);

function Alert({
    className,
    variant,
    role,
    ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
    return (
        <div
            data-slot="alert"
            // A danger notice interrupts; anything else is announced politely.
            role={role ?? (variant === "danger" ? "alert" : "status")}
            className={cn(alertVariants({ variant }), className)}
            {...props}
        />
    );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="alert-title"
            className={cn("col-start-2 text-sm font-medium", className)}
            {...props}
        />
    );
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="alert-description"
            className={cn("col-start-2 [&_p]:leading-relaxed", className)}
            {...props}
        />
    );
}

export { Alert, AlertTitle, AlertDescription, alertVariants };
