"use client";

import { toast } from "sonner";

import { Switch } from "~/components/ui/switch";
import { cn } from "~/lib/utils";

import { prospectsApi, type SourceKind, type SourceRow } from "../api";
import { useProspects } from "../_lib/context";
import { relativeTime } from "../_lib/format";
import { useResource } from "../_lib/useResource";
import { InlineError } from "../_components/EmptyState";
import { PageHeader } from "../_components/PageHeader";
import { SkeletonRows } from "../_components/SkeletonRows";

const KIND_LABEL: Record<SourceKind, string> = {
    api: "Directory or API",
    recipe: "Search-index listing",
    signal: "Signal",
};

export function SourcesScreen() {
    const { segmentId, reloadSegments } = useProspects();
    const res = useResource(segmentId ? `sources:${segmentId}` : null, () =>
        prospectsApi.sources(segmentId!)
    );
    const sources = res.data?.sources ?? [];
    const on = sources.filter(s => s.enabled && s.available).length;

    const toggle = async (source: SourceRow, enabled: boolean) => {
        res.mutate(current => ({
            sources: current.sources.map(s => (s.id === source.id ? { ...s, enabled } : s)),
        }));
        try {
            await prospectsApi.setSourceEnabled(source.id, enabled, segmentId!);
            await reloadSegments();
        } catch (e) {
            await res.reload();
            toast.error(e instanceof Error ? e.message : "Could not update the source");
        }
    };

    return (
        <div className="mx-auto flex max-w-[900px] flex-col gap-5">
            <PageHeader
                size="md"
                title="Sources"
                sub={
                    res.data
                        ? `${on} of ${sources.length} will be searched on the next run. Platforms are picked for this segment's buyer type, geographies and size.`
                        : undefined
                }
            />
            {res.error && <InlineError message={res.error} onRetry={() => void res.reload()} />}
            {res.loading ? (
                <SkeletonRows rows={8} height={60} />
            ) : (
                <div className="border-line bg-panel overflow-hidden rounded-lg border">
                    {sources.map(s => (
                        <div
                            key={s.id}
                            className="border-line-2 grid grid-cols-[1fr_auto] items-center gap-4 border-t px-4 py-3 first:border-t-0 md:grid-cols-[1fr_200px_auto]"
                        >
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <span
                                        className={cn(
                                            "text-ink text-sm font-medium",
                                            !s.available && "text-ink-2"
                                        )}
                                    >
                                        {s.label}
                                    </span>
                                    <span
                                        className={cn(
                                            "border-line text-ink-3 rounded-full border px-[7px] text-[11px] leading-[17px]",
                                            s.kind === "signal" && "border-dashed"
                                        )}
                                    >
                                        {KIND_LABEL[s.kind]}
                                    </span>
                                </div>
                                <div className="text-ink-3 mt-0.5 text-xs">{s.description}</div>
                                {!s.available && s.requires && (
                                    <div className="text-warn mt-1 text-xs">
                                        Needs <span className="font-mono">{s.requires}</span> in the
                                        environment.
                                    </div>
                                )}
                            </div>
                            <div className="text-ink-3 hidden text-xs tabular-nums md:block">
                                {s.lastYield ? (
                                    <>
                                        <span className="text-ink-2">
                                            {s.lastYield.found} found
                                        </span>
                                        {s.kind !== "signal" && (
                                            <>, {s.lastYield.newCompanies} new</>
                                        )}{" "}
                                        · {s.lastYield.cost}
                                        <div>{relativeTime(s.lastYield.at)}</div>
                                    </>
                                ) : (
                                    <>
                                        Not run yet
                                        <div>{s.cost}</div>
                                    </>
                                )}
                            </div>
                            <Switch
                                checked={s.enabled && s.available}
                                disabled={!s.available}
                                onCheckedChange={v => void toggle(s, v)}
                                aria-label={`${s.label} ${s.enabled ? "on" : "off"}`}
                            />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
