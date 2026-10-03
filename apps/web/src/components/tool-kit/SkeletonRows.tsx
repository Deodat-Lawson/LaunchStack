import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";

/** Rows at the real row height, so nothing jumps when data arrives. */
export function SkeletonRows({
    rows = 5,
    height = 44,
    className,
}: {
    rows?: number;
    height?: number;
    className?: string;
}) {
    return (
        <div className={cn("border-line bg-panel overflow-hidden rounded-lg border", className)}>
            {Array.from({ length: rows }).map((_, i) => (
                <div
                    key={i}
                    className="border-line-2 flex items-center gap-4 border-t px-4 first:border-t-0"
                    style={{ height }}
                >
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="h-3 w-1/4" />
                    <Skeleton className="ml-auto h-3 w-12" />
                </div>
            ))}
        </div>
    );
}

export function SkeletonBlock({ lines = 3, className }: { lines?: number; className?: string }) {
    return (
        <div className={cn("flex flex-col gap-2.5", className)}>
            {Array.from({ length: lines }).map((_, i) => (
                <Skeleton key={i} className="h-3" style={{ width: `${88 - i * 14}%` }} />
            ))}
        </div>
    );
}
