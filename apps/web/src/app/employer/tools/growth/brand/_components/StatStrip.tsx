import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";

export interface Stat {
    label: string;
    value: string;
    /** A short line under the value: "across 3 channels". */
    hint?: string;
}

/**
 * Numbers in a row, as one bordered panel with hairline dividers rather
 * than a tile per number. Folds to fewer columns by the tab's width.
 */
export function StatStrip({
    stats,
    loading = false,
    label,
    className,
}: {
    stats: Stat[];
    loading?: boolean;
    /** Names the strip for assistive tech: "Last 30 days". */
    label: string;
    className?: string;
}) {
    return (
        <dl
            aria-label={label}
            aria-busy={loading || undefined}
            className={cn(
                "border-line bg-panel @max-sm:grid-cols-2 grid overflow-hidden rounded-lg border",
                stats.length > 4
                    ? "@max-lg:grid-cols-4 grid-cols-7"
                    : "@max-md:grid-cols-2 grid-cols-4",
                className
            )}
        >
            {stats.map(stat => (
                <div
                    key={stat.label}
                    className="border-line-2 -ml-px -mt-px flex min-w-0 flex-col gap-1 border-l border-t px-4 py-3"
                >
                    <dt className="text-ink-3 truncate text-xs">{stat.label}</dt>
                    <dd className="text-ink text-[20px] font-medium tabular-nums leading-tight">
                        {loading ? <Skeleton className="h-5 w-16" /> : stat.value}
                    </dd>
                    {stat.hint && !loading && (
                        <dd className="text-ink-3 truncate text-xs">{stat.hint}</dd>
                    )}
                </div>
            ))}
        </dl>
    );
}
