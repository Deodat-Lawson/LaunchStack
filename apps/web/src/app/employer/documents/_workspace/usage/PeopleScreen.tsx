"use client";

/**
 * Everyone, ranked — Cursor's usage leaderboard, for a workspace: how many
 * days each person was active, what they asked, added and opened, the AI
 * that took and what it cost, the feature they leaned on, how much of this
 * month's limit they have used, and when they were last around. Any column
 * sorts; a row opens that person's numbers.
 *
 * Under the people, two rows that are nobody's: work by people who have
 * since left, and AI work no one person started (a sync, a scheduled job),
 * so the columns add up to the Overview's totals.
 */

import React, { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useTranslations } from "next-intl";

import { ProfileAvatar } from "~/components/ProfileAvatar";
import { useToolNav } from "~/components/tool-app/nav";
import { ToolLink } from "~/components/tool-app/ToolLink";
import { PageHeader } from "~/components/tools/PageHeader";
import { Badge } from "~/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "~/components/ui/table";
import { useRoleLabel } from "~/lib/authz/i18n";
import { csvFileName, downloadCsv, toCsv } from "~/lib/usage/csv";
import type { UsageCounts, UsagePeople, UsagePersonRow } from "~/lib/usage/types";
import { cn } from "~/lib/utils";

import { AllowanceBar, allowanceTone, useAllowanceFormat } from "../settings/aiAllowance";
import { useTimeFormat } from "../settings/people/format";
import { EmptyLine, FilterInput, LoadingRows } from "../team/ui";
import { useUsageFilters, useUsageLoad, windowQuery } from "./data";
import { useUsageFormat } from "./format";
import { usagePaths } from "./screens";
import { LoadFailed, WindowBar, useWindowLabel } from "./ui";

type SortKey =
    | "name"
    | "activeDays"
    | "questions"
    | "filesAdded"
    | "docsOpened"
    | "aiTokens"
    | "costUsd"
    | "allowance"
    | "lastActive";

function sortValue(person: UsagePersonRow, key: SortKey): number | string {
    switch (key) {
        case "name":
            return person.displayName.toLocaleLowerCase();
        case "activeDays":
            return person.activeDays;
        case "allowance":
            return person.allowance.percent ?? -1;
        case "lastActive":
            return person.lastActiveAt ? Date.parse(person.lastActiveAt) : 0;
        case "costUsd":
            return person.totals.costUsd ?? 0;
        default:
            return person.totals[key];
    }
}

export function matchesUsagePerson(person: UsagePersonRow, needle: string): boolean {
    if (!needle) return true;
    return [person.displayName, person.email, person.roleName, ...person.groups.map(g => g.name)]
        .join("\n")
        .toLowerCase()
        .includes(needle);
}

export function PeopleScreen() {
    const t = useTranslations("usage.people");
    const tm = useTranslations("usage.metrics");
    const format = useUsageFormat();
    // Rounded down, as Spending and Your usage round a limit: 99.6% never reads as 100.
    const allowance = useAllowanceFormat();
    const time = useTimeFormat();
    const roleLabel = useRoleLabel();
    const { navigate } = useToolNav();
    const { choice, groupId } = useUsageFilters();
    const query = useMemo(() => {
        const q = windowQuery(choice);
        if (groupId !== null) q.set("group", String(groupId));
        return q;
    }, [choice, groupId]);
    const load = useUsageLoad<UsagePeople>("/api/usage/people", query);
    const data = load.data;
    const range = useWindowLabel(data?.window);
    const [filter, setFilter] = useState("");
    const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
        key: "aiTokens",
        desc: true,
    });

    const needle = filter.trim().toLowerCase();
    const rows = useMemo(() => {
        const shown = (data?.people ?? []).filter(person => matchesUsagePerson(person, needle));
        return [...shown].sort((a, b) => {
            const x = sortValue(a, sort.key);
            const y = sortValue(b, sort.key);
            const order = x < y ? -1 : x > y ? 1 : 0;
            return (sort.desc ? -order : order) || a.displayName.localeCompare(b.displayName);
        });
    }, [data, needle, sort]);

    const exportPeople = () => {
        if (!data) return;
        const extra = (label: string, counts: UsageCounts | null) =>
            counts
                ? [
                      [
                          label,
                          "",
                          "",
                          "",
                          "",
                          counts.questions,
                          counts.filesAdded,
                          counts.docsOpened,
                          counts.aiCalls,
                          counts.aiTokens,
                          counts.costUsd,
                          "",
                          "",
                          "",
                          "",
                      ],
                  ]
                : [];
        const csv = toCsv(
            [
                "name",
                "email",
                "role",
                "groups",
                "active_days",
                "questions",
                "files_added",
                "documents_opened",
                "ai_calls",
                "ai_tokens",
                "estimated_cost_usd",
                "top_feature",
                "month_tokens_used",
                "month_limit",
                "last_active",
            ],
            [
                ...rows.map(person => [
                    person.displayName,
                    person.email,
                    roleLabel(person.role, person.roleName),
                    person.groups.map(g => g.name).join("; "),
                    person.activeDays,
                    person.totals.questions,
                    person.totals.filesAdded,
                    person.totals.docsOpened,
                    person.totals.aiCalls,
                    person.totals.aiTokens,
                    person.totals.costUsd,
                    person.topFeature ? format.feature(person.topFeature) : "",
                    person.allowance.used,
                    person.allowance.limit,
                    person.lastActiveAt,
                ]),
                // The rows that are nobody's show only while the list isn't filtered; so do they here.
                ...(needle ? [] : extra(t("formerMembers"), data.formerMembers)),
                ...(needle ? [] : extra(t("unattributed"), data.unattributed)),
            ]
        );
        downloadCsv(csvFileName("people", data.window), csv);
    };

    const header = (key: SortKey, label: string, className?: string) => {
        const active = sort.key === key;
        const Arrow = sort.desc ? ArrowDown : ArrowUp;
        return (
            <TableHead
                className={cn(key === "name" ? undefined : "text-right", className)}
                aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}
            >
                <button
                    type="button"
                    className={cn(
                        "hover:text-ink inline-flex items-center gap-1 whitespace-nowrap",
                        active && "text-ink"
                    )}
                    onClick={() =>
                        setSort(prev =>
                            prev.key === key
                                ? { key, desc: !prev.desc }
                                : { key, desc: key !== "name" }
                        )
                    }
                    data-testid={`usage-sort-${key}`}
                >
                    {label}
                    {active && <Arrow className="size-3" aria-hidden />}
                </button>
            </TableHead>
        );
    };

    // Work no one person started asks, adds and opens nothing: a dash, not a 0.
    const nobodyRow = (
        testId: string,
        label: string,
        counts: UsageCounts | null,
        aiOnly = false
    ) =>
        counts ? (
            <TableRow data-testid={testId} className="text-ink-3">
                <TableCell className="italic">{label}</TableCell>
                <TableCell className="@max-lg:hidden" />
                <TableCell className="@max-sm:hidden text-right tabular-nums">
                    {aiOnly ? "—" : format.num(counts.questions)}
                </TableCell>
                <TableCell className="@max-md:hidden text-right tabular-nums">
                    {aiOnly ? "—" : format.num(counts.filesAdded)}
                </TableCell>
                <TableCell className="@max-xl:hidden text-right tabular-nums">
                    {aiOnly ? "—" : format.num(counts.docsOpened)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                    {format.compact(counts.aiTokens)}
                </TableCell>
                <TableCell className="@max-md:hidden text-right tabular-nums">
                    {format.usd(counts.costUsd)}
                </TableCell>
                <TableCell className="@max-xl:hidden" />
                <TableCell className="@max-lg:hidden" />
                <TableCell className="@max-lg:hidden" />
            </TableRow>
        ) : null;

    return (
        <div className="mx-auto flex max-w-[1180px] flex-col gap-5" data-testid="usage-people">
            <PageHeader
                title={t("title")}
                sub={data ? t("sub", { range, count: data.people.length }) : " "}
                actions={
                    <>
                        <FilterInput
                            value={filter}
                            onChange={setFilter}
                            placeholder={t("filterPlaceholder")}
                        />
                        <WindowBar
                            groups={data?.groups}
                            onExport={exportPeople}
                            exportDisabled={!data}
                        />
                    </>
                }
            />

            {load.failed !== null && !data ? (
                <LoadFailed status={load.failed} onRetry={load.reload} />
            ) : !data ? (
                <LoadingRows flush rows={8} />
            ) : (
                <section
                    className={cn(
                        "border-line bg-panel min-w-0 overflow-hidden rounded-lg border",
                        load.loading && "opacity-60"
                    )}
                >
                    {rows.length === 0 ? (
                        <EmptyLine>{needle ? t("noMatch") : t("empty")}</EmptyLine>
                    ) : (
                        <Table className="text-[12.5px]" data-testid="usage-people-table">
                            <TableHeader>
                                <TableRow>
                                    {header("name", t("person"))}
                                    {header("activeDays", tm("activeDays"), "@max-lg:hidden")}
                                    {header("questions", tm("questions"), "@max-sm:hidden")}
                                    {header("filesAdded", tm("filesAdded"), "@max-md:hidden")}
                                    {header("docsOpened", tm("docsOpened"), "@max-xl:hidden")}
                                    {header("aiTokens", tm("aiTokens"))}
                                    {header("costUsd", tm("costUsd"), "@max-md:hidden")}
                                    <TableHead className="@max-xl:hidden">
                                        {t("topFeature")}
                                    </TableHead>
                                    {header("allowance", t("thisMonth"), "@max-lg:hidden")}
                                    {header("lastActive", t("lastActive"), "@max-lg:hidden")}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rows.map(person => {
                                    const percent = person.allowance.percent;
                                    return (
                                        <TableRow
                                            key={person.memberId}
                                            className="cursor-pointer"
                                            onClick={event => {
                                                // The name is a real link; let it handle its own click.
                                                if ((event.target as HTMLElement).closest("a"))
                                                    return;
                                                navigate(usagePaths.person(person.memberId));
                                            }}
                                            data-testid="usage-person-row"
                                        >
                                            <TableCell className="max-w-[240px]">
                                                <div className="flex min-w-0 items-center gap-2.5">
                                                    <ProfileAvatar
                                                        name={person.displayName}
                                                        email={person.email}
                                                        src={person.avatarUrl}
                                                        className="size-7"
                                                    />
                                                    <div className="min-w-0">
                                                        <ToolLink
                                                            href={usagePaths.person(
                                                                person.memberId
                                                            )}
                                                            className="text-ink block truncate font-medium hover:underline"
                                                        >
                                                            {person.displayName}
                                                        </ToolLink>
                                                        <div className="text-ink-3 flex items-center gap-1.5 truncate text-[11.5px]">
                                                            {roleLabel(
                                                                person.role,
                                                                person.roleName
                                                            )}
                                                            {person.isSelf && (
                                                                <Badge
                                                                    variant="secondary"
                                                                    className="h-4 px-1 text-[10px]"
                                                                >
                                                                    {t("you")}
                                                                </Badge>
                                                            )}
                                                            {person.status === "suspended" && (
                                                                <Badge
                                                                    variant="outline"
                                                                    className="h-4 px-1 text-[10px]"
                                                                >
                                                                    {t("suspended")}
                                                                </Badge>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell className="@max-lg:hidden text-right tabular-nums">
                                                {format.num(person.activeDays)}
                                            </TableCell>
                                            <TableCell className="@max-sm:hidden text-right tabular-nums">
                                                {format.num(person.totals.questions)}
                                            </TableCell>
                                            <TableCell className="@max-md:hidden text-right tabular-nums">
                                                {format.num(person.totals.filesAdded)}
                                            </TableCell>
                                            <TableCell className="@max-xl:hidden text-right tabular-nums">
                                                {format.num(person.totals.docsOpened)}
                                            </TableCell>
                                            <TableCell className="text-ink text-right font-medium tabular-nums">
                                                {format.compact(person.totals.aiTokens)}
                                            </TableCell>
                                            <TableCell className="@max-md:hidden text-right tabular-nums">
                                                {format.usd(person.totals.costUsd)}
                                            </TableCell>
                                            <TableCell className="@max-xl:hidden text-ink-2 truncate">
                                                {person.topFeature
                                                    ? format.feature(person.topFeature)
                                                    : "—"}
                                            </TableCell>
                                            <TableCell className="@max-lg:hidden w-[140px]">
                                                {percent === null ? (
                                                    <span className="text-ink-3 block text-right text-[11.5px]">
                                                        {t("noLimit", {
                                                            used: format.compact(
                                                                person.allowance.used
                                                            ),
                                                        })}
                                                    </span>
                                                ) : (
                                                    <div className="flex items-center gap-2">
                                                        <AllowanceBar
                                                            percent={percent}
                                                            blocked={person.allowance.blocked}
                                                            label={t("allowanceLabel", {
                                                                percent: allowance.share(percent),
                                                            })}
                                                            className="min-w-0 flex-1"
                                                        />
                                                        <span
                                                            className={cn(
                                                                "w-9 shrink-0 text-right text-[11.5px] tabular-nums",
                                                                allowanceTone(
                                                                    percent,
                                                                    person.allowance.blocked
                                                                ) === "danger"
                                                                    ? "text-danger-ink"
                                                                    : "text-ink-2"
                                                            )}
                                                        >
                                                            {allowance.share(percent)}
                                                        </span>
                                                    </div>
                                                )}
                                            </TableCell>
                                            <TableCell className="@max-lg:hidden text-ink-3 whitespace-nowrap text-right">
                                                {person.lastActiveAt
                                                    ? time.relative(person.lastActiveAt)
                                                    : t("never")}
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                                {!needle &&
                                    nobodyRow(
                                        "usage-former-row",
                                        t("formerMembers"),
                                        data.formerMembers
                                    )}
                                {!needle &&
                                    nobodyRow(
                                        "usage-unattributed-row",
                                        t("unattributed"),
                                        data.unattributed,
                                        true
                                    )}
                            </TableBody>
                        </Table>
                    )}
                </section>
            )}
        </div>
    );
}
