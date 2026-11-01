"use client";

/**
 * The workspace at a glance, Cursor's team dashboard for a knowledge
 * workspace: how many people were active, what they asked, added and opened,
 * how much AI that took and what it cost — each against the window before —
 * then day by day, by feature, and the people who used the most.
 */

import React, { useMemo } from "react";
import { useTranslations } from "next-intl";

import { ProfileAvatar } from "~/components/ProfileAvatar";
import { ToolLink } from "~/components/tool-app/ToolLink";
import { PageHeader } from "~/components/tools/PageHeader";
import { csvFileName, downloadCsv, toCsv } from "~/lib/usage/csv";
import type { UsagePeople, UsageSummary } from "~/lib/usage/types";

import { StatusNote } from "../settings/ui";
import { EmptyLine, LoadingRows, Panel } from "../team/ui";
import { ByKindPanel } from "./ByKindPanel";
import { DailyChart } from "./DailyChart";
import { FeatureTable, RouteTable } from "./FeatureTable";
import { useUsageFilters, useUsageLoad, windowQuery } from "./data";
import { changeOf, useUsageFormat } from "./format";
import { usagePaths } from "./screens";
import { LoadFailed, StatTile, TileGrid, WindowBar, useWindowLabel } from "./ui";

const TOP_PEOPLE = 5;

export function OverviewScreen() {
    const t = useTranslations("usage.overview");
    const tm = useTranslations("usage.metrics");
    const format = useUsageFormat();
    const { choice, groupId } = useUsageFilters();
    const query = useMemo(() => {
        const q = windowQuery(choice);
        if (groupId !== null) q.set("group", String(groupId));
        return q;
    }, [choice, groupId]);
    const summary = useUsageLoad<UsageSummary>("/api/usage/summary", query);
    const people = useUsageLoad<UsagePeople>("/api/usage/people", query);
    const data = summary.data;
    const range = useWindowLabel(data?.window);

    const exportDaily = () => {
        if (!data) return;
        const csv = toCsv(
            [
                "date",
                "active_people",
                "questions",
                "files_added",
                "documents_opened",
                "ai_requests",
                "ai_usage_chat_token_equivalents",
                "ai_chat_input_tokens",
                "ai_chat_output_tokens",
                "ai_chat_cached_input_tokens",
                "ai_embedded_tokens",
                "ai_web_searches",
                "ai_pages_read",
                "estimated_cost_usd",
            ],
            data.daily.map(day => [
                day.date,
                day.activePeople,
                day.questions,
                day.filesAdded,
                day.docsOpened,
                day.aiCalls,
                day.aiTokens,
                day.inputTokens,
                day.outputTokens,
                day.cachedInputTokens,
                day.embeddedTokens,
                day.searches,
                day.pages,
                day.costUsd,
            ])
        );
        downloadCsv(csvFileName("daily", data.window), csv);
    };

    const top = (people.data?.people ?? [])
        .filter(person => person.totals.aiTokens > 0 || person.totals.questions > 0)
        .slice(0, TOP_PEOPLE);
    const days = data?.window.days;

    return (
        <div className="mx-auto flex max-w-[1180px] flex-col gap-5" data-testid="usage-overview">
            <PageHeader
                title={t("title")}
                sub={
                    data
                        ? data.scope.kind === "group"
                            ? t("subGroup", { group: data.scope.name, range })
                            : t("sub", { range, members: data.members, days: data.window.days })
                        : " "
                }
                actions={
                    <WindowBar
                        groups={people.data?.groups}
                        onExport={exportDaily}
                        exportDisabled={!data}
                    />
                }
            />

            {summary.failed !== null && !data ? (
                <LoadFailed status={summary.failed} onRetry={summary.reload} />
            ) : !data ? (
                <LoadingRows flush rows={6} />
            ) : (
                <>
                    <TileGrid className={summary.loading ? "opacity-60" : undefined}>
                        <StatTile
                            testId="usage-tile-active"
                            label={tm("activePeople")}
                            value={t("ofMembers", {
                                active: format.num(data.totals.activePeople),
                                members: format.num(data.members),
                            })}
                            change={changeOf(data.totals.activePeople, data.previous.activePeople)}
                            previous={format.num(data.previous.activePeople)}
                            previousDays={days}
                        />
                        <StatTile
                            testId="usage-tile-questions"
                            label={tm("questions")}
                            value={format.compact(data.totals.questions)}
                            change={changeOf(data.totals.questions, data.previous.questions)}
                            previous={format.compact(data.previous.questions)}
                            previousDays={days}
                        />
                        <StatTile
                            testId="usage-tile-files"
                            label={tm("filesAdded")}
                            value={format.compact(data.totals.filesAdded)}
                            change={changeOf(data.totals.filesAdded, data.previous.filesAdded)}
                            previous={format.compact(data.previous.filesAdded)}
                            previousDays={days}
                        />
                        <StatTile
                            testId="usage-tile-docs"
                            label={tm("docsOpened")}
                            value={format.compact(data.totals.docsOpened)}
                            change={changeOf(data.totals.docsOpened, data.previous.docsOpened)}
                            previous={format.compact(data.previous.docsOpened)}
                            previousDays={days}
                        />
                        <StatTile
                            testId="usage-tile-tokens"
                            label={tm("aiTokens")}
                            value={format.compact(data.totals.aiTokens)}
                            change={changeOf(data.totals.aiTokens, data.previous.aiTokens)}
                            previous={format.compact(data.previous.aiTokens)}
                            previousDays={days}
                            sub={t("tokensUnit")}
                        />
                        <StatTile
                            testId="usage-tile-cost"
                            label={tm("costUsd")}
                            value={format.usd(data.totals.costUsd)}
                            change={
                                data.totals.costUsd === null
                                    ? undefined
                                    : changeOf(data.totals.costUsd, data.previous.costUsd ?? 0)
                            }
                            previous={format.usd(data.previous.costUsd)}
                            previousDays={data.totals.costUsd === null ? undefined : days}
                            sub={t("costUnpriced")}
                        />
                    </TileGrid>

                    {(data.unattributedTokens > 0 || data.workspaceOwnedCalls > 0) && (
                        <div className="flex flex-col gap-1">
                            {data.unattributedTokens > 0 && (
                                <StatusNote tone="muted" style={{ marginBottom: 0 }}>
                                    {t("unattributed", {
                                        tokens: format.compact(data.unattributedTokens),
                                    })}
                                </StatusNote>
                            )}
                            {data.workspaceOwnedCalls > 0 && (
                                <StatusNote tone="muted" style={{ marginBottom: 0 }}>
                                    {t("ownEndpoint", {
                                        calls: format.num(data.workspaceOwnedCalls),
                                    })}
                                </StatusNote>
                            )}
                        </div>
                    )}

                    <ByKindPanel
                        totals={data.totals}
                        rates={data.rates}
                        loading={summary.loading}
                    />
                    <DailyChart
                        title={t("daily")}
                        daily={data.daily}
                        byFeature={data.byFeature}
                        loading={summary.loading}
                    />

                    <div className="@max-lg:grid-cols-1 grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-start gap-5">
                        <FeatureTable title={t("byFeature")} rows={data.byFeature} />
                        <div className="flex min-w-0 flex-col gap-5">
                            <Panel
                                title={t("topPeople")}
                                testId="usage-top-people"
                                action={
                                    <ToolLink
                                        href={usagePaths.people()}
                                        className="text-brand-ink text-[12px] font-medium hover:underline"
                                    >
                                        {t("seeEveryone")}
                                    </ToolLink>
                                }
                            >
                                {!people.data ? (
                                    <LoadingRows rows={3} />
                                ) : top.length === 0 ? (
                                    <EmptyLine>{t("nobody")}</EmptyLine>
                                ) : (
                                    <ol className="m-0 flex list-none flex-col p-0 px-1.5">
                                        {top.map((person, index) => (
                                            <li key={person.memberId}>
                                                <ToolLink
                                                    href={usagePaths.person(person.memberId)}
                                                    className="hover:bg-panel-2 flex items-center gap-2.5 rounded-md px-2 py-1.5"
                                                >
                                                    <span className="text-ink-4 w-4 text-right text-[11.5px] tabular-nums">
                                                        {index + 1}
                                                    </span>
                                                    <ProfileAvatar
                                                        name={person.displayName}
                                                        email={person.email}
                                                        src={person.avatarUrl}
                                                        className="size-6"
                                                    />
                                                    <span className="text-ink min-w-0 flex-1 truncate text-[13px]">
                                                        {person.displayName}
                                                    </span>
                                                    <span className="text-ink-3 shrink-0 text-[12px] tabular-nums">
                                                        {t("topLine", {
                                                            questions: format.compact(
                                                                person.totals.questions
                                                            ),
                                                            tokens: format.compact(
                                                                person.totals.aiTokens
                                                            ),
                                                        })}
                                                    </span>
                                                </ToolLink>
                                            </li>
                                        ))}
                                    </ol>
                                )}
                            </Panel>
                            <RouteTable title={t("byRoute")} rows={data.byRoute} />
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
