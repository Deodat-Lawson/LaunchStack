import { cn } from "~/lib/utils";

import { ProspectsMark } from "./ProspectsMark";

/**
 * An empty state names what to do next and carries the control that does
 * it. It is a quiet panel, not a card with an illustration.
 */
export function EmptyState({
    title,
    body,
    action,
    mark = false,
    className,
}: {
    title: string;
    body?: string;
    action?: React.ReactNode;
    mark?: boolean;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "border-line bg-panel flex flex-col items-start gap-2 rounded-lg border px-5 py-5",
                className
            )}
        >
            {mark && <ProspectsMark size={22} className="text-ink-3 mb-1" />}
            <div className="text-ink text-sm font-medium">{title}</div>
            {body && <p className="text-ink-2 max-w-[60ch] text-sm">{body}</p>}
            {action && <div className="mt-1 flex flex-wrap gap-2">{action}</div>}
        </div>
    );
}

export function InlineError({
    message,
    onRetry,
    className,
}: {
    message: string;
    onRetry?: () => void;
    className?: string;
}) {
    return (
        <div role="alert" className={cn("text-danger flex items-center gap-3 text-sm", className)}>
            <span>{message}</span>
            {onRetry && (
                <button
                    type="button"
                    onClick={onRetry}
                    className="focus-visible:ring-brand/50 rounded-sm underline underline-offset-2 outline-none focus-visible:ring-2"
                >
                    Retry
                </button>
            )}
        </div>
    );
}
