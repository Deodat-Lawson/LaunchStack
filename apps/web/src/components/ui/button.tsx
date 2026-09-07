import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

const buttonVariants = cva(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-brand focus-visible:ring-brand/50 focus-visible:ring-[3px] aria-invalid:ring-danger/20 dark:aria-invalid:ring-danger/40 aria-invalid:border-danger",
    {
        variants: {
            variant: {
                default: "bg-brand text-brand-fg hover:bg-brand/90",
                destructive:
                    "bg-danger text-white hover:bg-danger/90 focus-visible:ring-danger/20 dark:focus-visible:ring-danger/40 dark:bg-danger/60",
                outline:
                    "border bg-surface text-ink hover:bg-brand-soft hover:text-brand-ink dark:bg-line/30 dark:border-line dark:hover:bg-line/50",
                secondary: "bg-panel-2 text-ink-2 hover:bg-panel-2/80",
                ghost: "hover:bg-brand-soft hover:text-brand-ink dark:hover:bg-brand-soft",
                link: "text-brand underline-offset-4 hover:underline",
            },
            size: {
                default: "h-9 px-4 py-2 has-[>svg]:px-3",
                sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
                lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
                icon: "size-9 rounded-md",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    }
);

const Button = React.forwardRef<
    HTMLButtonElement,
    React.ComponentProps<"button"> &
        VariantProps<typeof buttonVariants> & {
            asChild?: boolean;
        }
>(({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";

    return (
        <Comp
            ref={ref}
            data-slot="button"
            className={cn(buttonVariants({ variant, size, className }))}
            {...props}
        />
    );
});

Button.displayName = "Button";

export { Button, buttonVariants };
