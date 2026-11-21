"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { ToolLink } from "~/components/tool-app/ToolLink";
import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { PageHeader, SectionHeading } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";

import { paths, useRenewalsFormat } from "./bits";
import { DECISIONS, TODAY, daysUntil, noticeBy, useContracts, type Contract } from "./data";

/**
 * A tool's home: what needs you this week, then what is coming. One display
 * line (`PageHeader`), the primary action beside it, then sections that each
 * open with a `SectionHeading`. The accent phrase is for a home like this —
 * working screens (a list, a record, a form) have a plain title.
 */
export function OverviewScreen() {
    const t = useTranslations("designTemplate.overview");
    const tDecision = useTranslations("designTemplate.decision");
    const f = useRenewalsFormat();
    const contracts = useContracts();
    const quarterEnd = "2027-03-31";

    const newButton = (
        <Button asChild size="sm">
            <ToolLink href={paths.create()}>
                <Plus />
                {t("newRenewal")}
            </ToolLink>
        </Button>
    );

    if (contracts.status === "ready" && contracts.data.length === 0) {
        // First run: say what the tool does and hand over the one control
        // that starts it. No stats of zeros, no empty sections.
        return (
            <div className="mx-auto flex max-w-[1080px] flex-col gap-7">
                <PageHeader
                    title={t("title")}
                    sub={t("subEmpty", { date: f.longDate(quarterEnd) })}
                />
                <EmptyState title={t("emptyTitle")} body={t("emptyBody")} action={newButton} />
            </div>
        );
    }

    const list = contracts.data ?? [];
    const decide = list.filter(c => c.status === "decide");
    const upcoming = [...list]
        .filter(c => daysUntil(c.renewsOn) <= 90)
        .sort((a, b) => a.renewsOn.localeCompare(b.renewsOn));
    const stats = [
        {
            label: t("stats.due30"),
            value: String(list.filter(c => daysUntil(c.renewsOn) <= 30).length),
        },
        { label: t("stats.value"), value: f.money(list.reduce((sum, c) => sum + c.value, 0)) },
        { label: t("stats.auto"), value: String(list.filter(c => c.status === "auto").length) },
        { label: t("stats.decide"), value: String(decide.length), attention: decide.length > 0 },
    ];

    return (
        <div className="mx-auto flex max-w-[1080px] flex-col gap-7">
            <PageHeader
                title={t("title")}
                accent={t("accent")}
                sub={
                    contracts.status === "ready" ? (
                        t("sub", {
                            total: list.length,
                            date: f.longDate(quarterEnd),
                            decide: decide.length,
                        })
                    ) : contracts.status === "loading" ? (
                        <Skeleton className="h-3 w-64" />
                    ) : undefined
                }
                actions={newButton}
            />

            {contracts.status === "error" ? (
                <InlineError message={t("loadFailed")} onRetry={contracts.retry} />
            ) : (
                <>
                    {/* Numbers: a definition list, label above value, tabular
                        figures so columns of digits line up. */}
                    <section aria-label={t("stats.label")}>
                        <dl className="@max-md:grid-cols-2 grid grid-cols-4 gap-3">
                            {stats.map(stat => (
                                <div
                                    key={stat.label}
                                    className="border-line bg-panel rounded-lg border px-4 py-3"
                                >
                                    <dt className="text-ink-3 text-xs">{stat.label}</dt>
                                    <dd
                                        className={cn(
                                            "mt-1 text-xl font-medium tabular-nums",
                                            stat.attention ? "text-warn-ink" : "text-ink"
                                        )}
                                    >
                                        {contracts.status === "loading" ? (
                                            <Skeleton className="my-1.5 h-4 w-16" />
                                        ) : (
                                            stat.value
                                        )}
                                    </dd>
                                </div>
                            ))}
                        </dl>
                    </section>

                    <section>
                        <SectionHeading title={t("needsDecision")} />
                        {contracts.status === "loading" ? (
                            <SkeletonRows rows={3} height={56} />
                        ) : decide.length === 0 ? (
                            <p className="text-ink-3 text-[13px]">{t("needsDecisionEmpty")}</p>
                        ) : (
                            <RowList
                                contracts={decide}
                                detail={c => <NoticeLine contract={c} />}
                                trailing={c => f.dayMonth(c.renewsOn)}
                            />
                        )}
                    </section>

                    <div className="@max-lg:grid-cols-1 grid grid-cols-2 gap-7">
                        <section className="min-w-0">
                            <SectionHeading title={t("comingUp")} aside={t("comingUpAside")} />
                            {contracts.status === "loading" ? (
                                <SkeletonRows rows={4} height={52} />
                            ) : (
                                <RowList
                                    contracts={upcoming.slice(0, 5)}
                                    detail={c => <span>{c.owner}</span>}
                                    trailing={c => f.dayMonth(c.renewsOn)}
                                />
                            )}
                        </section>
                        <section className="min-w-0">
                            <SectionHeading
                                title={t("recentlyDecided")}
                                aside={
                                    <ToolLink
                                        href={paths.contracts()}
                                        className="text-brand-ink hover:underline"
                                    >
                                        {t("allContracts")}
                                    </ToolLink>
                                }
                            />
                            <ul className="border-line bg-panel m-0 list-none overflow-hidden rounded-lg border p-0">
                                {DECISIONS.map(d => (
                                    <li
                                        key={d.vendor}
                                        className="border-line-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t px-4 py-2.5 first:border-t-0"
                                    >
                                        <span className="min-w-0">
                                            <span className="text-ink block truncate text-sm font-medium">
                                                {d.vendor}
                                            </span>
                                            <span className="text-ink-3 block truncate text-xs">
                                                {t("decidedBy", {
                                                    decision: tDecision(d.decision),
                                                    person: d.person,
                                                })}
                                            </span>
                                        </span>
                                        <span className="text-ink-3 text-xs tabular-nums">
                                            {f.relativeTime(d.on, Date.parse(TODAY))}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    </div>
                </>
            )}
        </div>
    );
}

/**
 * The house list: one bordered panel, hairline between rows, a strong first
 * line and a quiet second one, the row itself the link. Same height as the
 * `SkeletonRows` it replaces, so nothing jumps when data arrives.
 */
function RowList({
    contracts,
    detail,
    trailing,
}: {
    contracts: Contract[];
    detail: (c: Contract) => React.ReactNode;
    /** Right-hand value. The section heading already says the status, so rows don't repeat it. */
    trailing: (c: Contract) => React.ReactNode;
}) {
    return (
        <ul className="border-line bg-panel m-0 list-none overflow-hidden rounded-lg border p-0">
            {contracts.map(c => (
                <li key={c.id} className="border-line-2 border-t first:border-t-0">
                    <ToolLink
                        href={paths.contract(c.id)}
                        className="hover:bg-panel-2 focus-visible:bg-panel-2 focus-visible:ring-brand/50 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-2.5 no-underline outline-none focus-visible:ring-2 focus-visible:ring-inset"
                    >
                        <span className="min-w-0">
                            <span className="text-ink block truncate text-sm font-medium">
                                {c.vendor}
                            </span>
                            <span className="text-ink-3 block truncate text-xs">{detail(c)}</span>
                        </span>
                        <span className="text-ink-2 text-xs tabular-nums">{trailing(c)}</span>
                    </ToolLink>
                </li>
            ))}
        </ul>
    );
}

function NoticeLine({ contract }: { contract: Contract }) {
    const t = useTranslations("designTemplate.overview");
    const days = daysUntil(noticeBy(contract));
    return days < 0 ? (
        <span className="text-danger-ink">{t("noticePassed")}</span>
    ) : (
        <span className={cn(days <= 14 && "text-warn-ink")}>{t("noticeIn", { days })}</span>
    );
}
