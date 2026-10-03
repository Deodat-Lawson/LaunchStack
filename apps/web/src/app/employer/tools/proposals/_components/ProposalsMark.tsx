import { PenLine } from "lucide-react";

import { cn } from "~/lib/utils";

/**
 * Proposals' tile: the pen on the brand square. The frame sets the name
 * beside it, so this is the mark alone (21px, the size `ToolFrame` draws).
 */
export function ProposalsMark({ className }: { className?: string }) {
    return (
        <span
            className={cn(
                "bg-brand text-brand-fg inline-flex size-[21px] shrink-0 items-center justify-center rounded-[27%]",
                className
            )}
            aria-hidden
        >
            <PenLine className="size-3" strokeWidth={2.25} />
        </span>
    );
}
