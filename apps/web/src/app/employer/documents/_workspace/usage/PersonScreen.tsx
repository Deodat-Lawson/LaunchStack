"use client";

/**
 * One person's numbers, for an admin: the same tiles, chart and feature
 * table as the Overview, scoped to them, with their limit this month and
 * links to their AI activity, their limit and their profile in the Team tab.
 */

import React, { useMemo } from "react";
import { ListTree, SlidersHorizontal, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";

import { ProfileAvatar } from "~/components/ProfileAvatar";
import { ToolLink } from "~/components/tool-app/ToolLink";
import { useToolNav } from "~/components/tool-app/nav";
import { Button } from "~/components/ui/button";
import { useRoleLabel } from "~/lib/authz/i18n";
import { toolTabHref } from "~/lib/tool-app/locations";
import { csvFileName, downloadCsv, toCsv } from "~/lib/usage/csv";
import type { UsagePeople, UsageSummary } from "~/lib/usage/types";
import { usePermissions } from "~/lib/use-permissions";

import { AllowanceBar, useAllowanceFormat } from "../settings/aiAllowance";
import { useTimeFormat } from "../settings/people/format";
import { BackButton, LoadingRows, Panel } from "../team/ui";
import { ByKindPanel } from "./ByKindPanel";
import { DailyChart } from "./DailyChart";
import { FeatureTable } from "./FeatureTable";
import { useUsageFilters, useUsageLoad, windowQuery } from "./data";
import { changeOf, useUsageFormat } from "./format";
import { usagePaths } from "./screens";
import { LoadFailed, StatTile, TileGrid, WindowBar, useWindowLabel } from "./ui";

/** Where an admin changes someone's limit: the Spending screen's per-person list. */
const LIMITS_FOCUS = "usage.memberMonthlyTokenLimit";

export function PersonScreen({ memberId }: { memberId: number }) {
    const t = useTranslations("usage.person");
    const tm = useTranslations("usage.metrics");
    const format = useUsageFormat();
    const allowance = useAllowanceFormat();
    const time = useTimeFormat();
    const roleLabel = useRoleLabel();
    const { navigate } = useToolNav();
    const { can } = usePermissions();
    const { choice } = useUsageFilters();
    const windowParams = useMemo(() => windowQuery(choice), [choice]);
    const summaryQuery = useMemo(() => {
        const q = new URLSearchParams(windowParams);
        q.set("person", String(memberId));
        return q;
    }, [windowParams, memberId]);
    const summary = useUsageLoad<UsageSummary>("/api/usage/summary", summaryQuery);
    const people = useUsageLoad<UsagePeople>("/api/usage/people", windowParams);
    const person = people.data?.people.find(p => p.memberId === memberId);
    const data = summary.data;
    const range = useWindowLabel(data?.window);
    const days = data?.window.days;

    const back = <BackButton label={t("back")} onClick={() => navigate(usagePaths.people())} />;

    if (summary.failed === 404 || (people.data && !person && summary.failed !== null)) {
        return (
            <div className="mx-auto flex max-w-[1180px] flex-col gap-4">
                <div>{back}</div>
                <p className="text-ink-2 m-0 text-[13px]">{t("gone")}</p>
            </div>
        );
    }

    const exportDaily = () => {
        if (!data) return;
        const csv = toCsv(
            [
                "date",
                "questions",
                "files_added",
                "documents_opened",
                "ai_requests",
                "ai_usage_chat_token_equivalents",
                "ai_chat_input_tokens",
                "ai_chat_output_tokens",
                "ai_embedded_tokens",
                "ai_web_searches",
                "ai_pages_read",
                "estimated_cost_usd",
            ],
            data.daily.map(day => [
                day.date,
                day.questions,
                day.filesAdded,
                day.docsOpened,
                day.aiCalls,
                day.aiTokens,
                day.inputTokens,
                day.outputTokens,
                day.embeddedTokens,
                day.searches,
                day.pages,
                day.costUsd,
            ])
        );
        const who = (person?.displayName ?? String(memberId)).replace(/[^\p{L}\p{N}]+/gu, "-");
        downloadCsv(csvFileName(`person-${who}`, data.window), csv);
    };

    return (
        <div className="mx-auto flex max-w-[1180px] flex-col gap-5" data-testid="usage-person">
            <div>{back}</div>
            <header className="@max-md:flex-col @max-md:items-start flex items-end justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                    <ProfileAvatar
                        name={person?.displayName}
                        email={person?.email}
                        src={person?.avatarUrl}
                        className="size-12"
                    />
                    <div className="min-w-0">
                        <h1 className="display text-ink m-0 truncate text-[26px] leading-tight tracking-[-0.02em]">
                            {person?.displayName ??
                                (data?.scope.kind === "person" ? data.scope.displayName : " ")}
                        </h1>
                        <div className="text-ink-3 mt-0.5 truncate text-[13px]">
                            {person
                                ? t("sub", {
                                      role: roleLabel(person.role, person.roleName),
                                      email: person.email,
                                      lastActive: person.lastActiveAt
                                          ? time.relative(person.lastActiveAt)
                                          : t("never"),
                                  })
                                : " "}
                        </div>
                    </div>
                </div>
                <WindowBar onExport={exportDaily} exportDisabled={!data} />
            </header>

            {summary.failed !== null && !data ? (
                <LoadFailed status={summary.failed} onRetry={summary.reload} />
            ) : !data ? (
                <LoadingRows flush rows={6} />
            ) : (
                <>
                    <p className="text-ink-3 m-0 -mt-2 text-[12.5px]">
                        {t("range", { range, days: data.window.days })}
                    </p>
                    <TileGrid className={summary.loading ? "opacity-60" : undefined}>
                        <StatTile
                            label={tm("activeDays")}
                            value={t("activeDaysOf", {
                                active: format.num(data.totals.activeDays),
                                days: format.num(data.window.days),
                            })}
                            change={changeOf(data.totals.activeDays, data.previous.activeDays)}
                            previous={format.num(data.previous.activeDays)}
                            previousDays={days}
                        />
                        <StatTile
                            label={tm("questions")}
                            value={format.compact(data.totals.questions)}
                            change={changeOf(data.totals.questions, data.previous.questions)}
                            previous={format.compact(data.previous.questions)}
                            previousDays={days}
                        />
                        <StatTile
                            label={tm("filesAdded")}
                            value={format.compact(data.totals.filesAdded)}
                            change={changeOf(data.totals.filesAdded, data.previous.filesAdded)}
                            previous={format.compact(data.previous.filesAdded)}
                            previousDays={days}
                        />
                        <StatTile
                            label={tm("docsOpened")}
                            value={format.compact(data.totals.docsOpened)}
                            change={changeOf(data.totals.docsOpened, data.previous.docsOpened)}
                            previous={format.compact(data.previous.docsOpened)}
                            previousDays={days}
                        />
                        <StatTile
                            label={tm("aiTokens")}
                            value={format.compact(data.totals.aiTokens)}
                            change={changeOf(data.totals.aiTokens, data.previous.aiTokens)}
                            previous={format.compact(data.previous.aiTokens)}
                            previousDays={days}
                        />
                        <StatTile
                            label={tm("costUsd")}
                            value={format.usd(data.totals.costUsd)}
                            change={
                                data.totals.costUsd === null
                                    ? undefined
                                    : changeOf(data.totals.costUsd, data.previous.costUsd ?? 0)
                            }
                            previous={format.usd(data.previous.costUsd)}
                            previousDays={data.totals.costUsd === null ? undefined : days}
                        />
                    </TileGrid>
                    <ByKindPanel totals={data.totals} rates={data.rates} />

                    <DailyChart
                        title={t("daily")}
                        daily={data.daily}
                        byFeature={data.byFeature}
                        measures={["aiTokens", "questions", "filesAdded", "docsOpened", "costUsd"]}
                        loading={summary.loading}
                    />

                    <div className="@max-lg:grid-cols-1 grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-start gap-5">
                        <FeatureTable
                            title={t("byFeature")}
                            rows={data.byFeature}
                            showPeople={false}
                        />
                        <Panel title={t("thisMonth")} testId="usage-person-allowance">
                            {!person ? (
                                <LoadingRows rows={2} />
                            ) : (
                                <div className="flex flex-col gap-2 px-3.5 pb-2">
                                    <div className="text-ink text-[22px] font-semibold tabular-nums leading-tight">
                                        {format.compact(person.allowance.used)}
                                    </div>
                                    {person.allowance.percent === null ? (
                                        <p className="text-ink-3 m-0 text-[12.5px]">
                                            {t("noLimit")}
                                        </p>
                                    ) : (
                                        <>
                                            <AllowanceBar
                                                percent={person.allowance.percent}
                                                blocked={person.allowance.blocked}
                                                label={t("allowanceLabel", {
                                                    percent: allowance.share(
                                                        person.allowance.percent
                                                    ),
                                                })}
                                            />
                                            <p className="text-ink-2 m-0 text-[12.5px]">
                                                {t("usedOf", {
                                                    percent: allowance.share(
                                                        person.allowance.percent
                                                    ),
                                                    limit: format.compact(
                                                        person.allowance.limit ?? 0
                                                    ),
                                                    date: format.longDay(person.allowance.resetsAt),
                                                })}
                                            </p>
                                        </>
                                    )}
                                    <div className="mt-1 flex flex-wrap gap-2">
                                        <Button asChild variant="outline" size="sm">
                                            <ToolLink
                                                href={usagePaths.activity({ person: memberId })}
                                            >
                                                <ListTree className="size-3.5" />
                                                {t("seeActivity")}
                                            </ToolLink>
                                        </Button>
                                        {can("settings.manage") && (
                                            <Button asChild variant="outline" size="sm">
                                                <ToolLink href={usagePaths.spending(LIMITS_FOCUS)}>
                                                    <SlidersHorizontal className="size-3.5" />
                                                    {t("changeLimit")}
                                                </ToolLink>
                                            </Button>
                                        )}
                                        <Button asChild variant="outline" size="sm">
                                            <ToolLink
                                                href={toolTabHref("team", `/people/${memberId}`)}
                                            >
                                                <UserRound className="size-3.5" />
                                                {t("profile")}
                                            </ToolLink>
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </Panel>
                    </div>
                </>
            )}
        </div>
    );
}
