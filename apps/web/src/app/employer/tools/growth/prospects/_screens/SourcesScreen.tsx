"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Switch } from "~/components/ui/switch";
import { cn } from "~/lib/utils";

import { useCopyText } from "~/lib/tools/copyText";
import { useGrowthFormat } from "../../_lib/format";
import { prospectsApi, type SourceRow } from "../api";
import { useErrorText } from "~/lib/tools/errorText";
import { useProspects } from "../_lib/context";
import { useResource } from "~/lib/tools/useResource";
import { InlineError } from "~/components/tools/EmptyState";
import { PageHeader } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";

export function SourcesScreen() {
    const t = useTranslations("growth.prospects");
    const { relativeTime } = useGrowthFormat();
    const word = useCopyText();
    const errorText = useErrorText();
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
            toast.error(errorText(e, t("sources.updateFailed")));
        }
    };

    return (
        <div className="mx-auto flex max-w-[900px] flex-col gap-5">
            <PageHeader
                size="md"
                title={t("common.sources")}
                sub={res.data ? t("sources.sub", { on, total: sources.length }) : undefined}
            />
            {res.error && <InlineError message={res.error} onRetry={() => void res.reload()} />}
            {res.loading ? (
                <SkeletonRows rows={8} height={60} />
            ) : (
                <div className="border-line bg-panel overflow-hidden rounded-lg border">
                    {sources.map(s => {
                        const label = word(s.labelCopy, s.label);
                        return (
                            <div
                                key={s.id}
                                className="border-line-2 @max-md:grid-cols-[1fr_auto] grid grid-cols-[1fr_200px_auto] items-center gap-4 border-t px-4 py-3 first:border-t-0"
                            >
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span
                                            className={cn(
                                                "text-ink text-sm font-medium",
                                                !s.available && "text-ink-2"
                                            )}
                                        >
                                            {label}
                                        </span>
                                        <span
                                            className={cn(
                                                "border-line text-ink-3 rounded-full border px-[7px] text-[11px] leading-[17px]",
                                                s.kind === "signal" && "border-dashed"
                                            )}
                                        >
                                            {t(`sourceKind.${s.kind}`)}
                                        </span>
                                    </div>
                                    <div className="text-ink-3 mt-0.5 text-xs">
                                        {word(s.descriptionCopy, s.description)}
                                    </div>
                                    {!s.available && s.requires && (
                                        <div className="text-warn mt-1 text-xs">
                                            {t.rich("sources.needs", {
                                                key: s.requires,
                                                code: chunks => (
                                                    <span className="font-mono">{chunks}</span>
                                                ),
                                            })}
                                        </div>
                                    )}
                                </div>
                                <div className="text-ink-3 @max-md:hidden text-xs tabular-nums">
                                    {s.lastYield ? (
                                        <>
                                            {s.kind === "signal"
                                                ? t.rich("sources.lastYieldSignals", {
                                                      found: s.lastYield.found,
                                                      cost: word(
                                                          s.lastYield.costCopy,
                                                          s.lastYield.cost
                                                      ),
                                                      num: chunks => (
                                                          <span className="text-ink-2">
                                                              {chunks}
                                                          </span>
                                                      ),
                                                  })
                                                : t.rich("sources.lastYield", {
                                                      found: s.lastYield.found,
                                                      fresh: s.lastYield.newCompanies,
                                                      cost: word(
                                                          s.lastYield.costCopy,
                                                          s.lastYield.cost
                                                      ),
                                                      num: chunks => (
                                                          <span className="text-ink-2">
                                                              {chunks}
                                                          </span>
                                                      ),
                                                  })}
                                            <div>{relativeTime(s.lastYield.at)}</div>
                                        </>
                                    ) : (
                                        <>
                                            {t("sources.notRun")}
                                            <div>{word(s.costCopy, s.cost)}</div>
                                        </>
                                    )}
                                </div>
                                <span title={s.locked ? t("sources.locked") : undefined}>
                                    <Switch
                                        checked={s.enabled && s.available}
                                        disabled={!s.available || s.locked}
                                        onCheckedChange={v => void toggle(s, v)}
                                        aria-label={
                                            s.enabled
                                                ? t("sources.switchOn", { label })
                                                : t("sources.switchOff", { label })
                                        }
                                    />
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
