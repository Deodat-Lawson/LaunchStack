import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

/**
 * The centred panel a viewer shows when it cannot show the file: a tinted
 * glyph, what happened, and the one action that recovers (retry, or open the
 * file somewhere else). One copy, so a failure reads the same whichever
 * viewer hit it.
 */
export function ViewerNotice({
    icon,
    title,
    detail,
    action,
    tone = "danger",
    overlay = false,
}: {
    icon: ReactNode;
    title: string;
    detail?: ReactNode;
    action?: ReactNode;
    /** `danger` for a failure; `warn` for a file this viewer can't render here. */
    tone?: "danger" | "warn";
    /** Cover the viewer (absolutely positioned) instead of filling the flow. */
    overlay?: boolean;
}) {
    return (
        <div
            role={tone === "danger" ? "alert" : undefined}
            className={cn(
                "bg-panel-2/30 flex h-full flex-col items-center justify-center gap-4 p-8 text-center",
                overlay && "absolute inset-0 z-10"
            )}
        >
            <div
                className={cn(
                    "flex size-14 items-center justify-center rounded-2xl [&_svg]:size-7",
                    tone === "danger" ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn-ink"
                )}
            >
                {icon}
            </div>
            <div className="max-w-sm">
                <p className="text-ink text-sm font-medium">{title}</p>
                {detail && <p className="text-ink-3 mt-1 text-xs">{detail}</p>}
                {action && <div className="mt-4">{action}</div>}
            </div>
        </div>
    );
}
