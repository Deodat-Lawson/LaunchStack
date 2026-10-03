import * as React from "react";

import { cn } from "~/lib/utils";

// No font size here: the default (16px on phones, 14px from md) is the
// [data-slot="textarea"] rule in src/styles/globals.css, so any text-* size a
// caller passes wins at every width (see ./input.tsx).
const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
    function Textarea({ className, ...props }, ref) {
        return (
            <textarea
                ref={ref}
                data-slot="textarea"
                className={cn(
                    "border-line placeholder:text-ink-3 focus-visible:border-brand focus-visible:ring-brand/50 aria-invalid:ring-danger/20 dark:aria-invalid:ring-danger/40 aria-invalid:border-danger dark:bg-line/30 field-sizing-content bg-line-background flex min-h-16 w-full resize-none rounded-md border px-3 py-2 outline-none transition-[color,box-shadow] focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
                    className
                )}
                {...props}
            />
        );
    }
);

export { Textarea };
