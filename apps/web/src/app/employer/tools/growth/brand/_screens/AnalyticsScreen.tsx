"use client";

import { ArrowDown, ArrowUp, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";

import { ToolLink } from "~/components/tool-app/ToolLink";
import { useToolPathname, useToolRouter, useToolSearchParams } from "~/components/tool-app/nav";
import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { PageHeader, SectionHeading } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { Button } from "~/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "~/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { useResource } from "~/lib/tools/useResource";
import { cn } from "~/lib/utils";

import { useGrowthFormat } from "../../_lib/format";
import { useGrowthPaths } from "../../_lib/paths";
import { ChannelAvatar, ChannelLabel } from "../_components/ChannelAvatar";
import { NETWORK_LABEL } from "../_components/NetworkMark";
import { StatStrip } from "../_components/StatStrip";
import { SyncButton, SyncProblems, SyncedAt, useBrandSync } from "../_components/Sync";
import { engagementOf, percent, sortRows, type SortDir } from "../_lib/numbers";
import { brandApi, type BrandPost, type InsightsChannel } from "../api";

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];
const DEFAULT_RANGE: Range = 30;

function isRange(n: number): n is Range {
    return (RANGES as readonly number[]).includes(n);
}

type PostKey =
    | "excerpt"
    | "channel"
    | "published"
    | "impressions"
    | "reactions"
    | "comments"
    | "shares"
    | "clicks"
    | "engagement";

const POST_VALUE: Record<PostKey, (p: BrandPost) => number | string | null> = {
    excerpt: p => p.body,
    channel: p => p.channel?.name ?? NETWORK_LABEL[p.platform],
    published: p => (p.publishedAt ? new Date(p.publishedAt).getTime() : null),
    impressions: p => p.metrics?.impressions ?? null,
    reactions: p => p.metrics?.reactions ?? null,
    comments: p => p.metrics?.comments ?? null,
    shares: p => p.metrics?.shares ?? null,
    clicks: p => p.metrics?.clicks ?? null,
    engagement: p => engagementOf(p.metrics),
};

/** A column header that sorts its table; says its order to assistive tech. */
function SortHead({
    label,
    column,
    sort,
    onSort,
    numeric = true,
    className,
}: {
    label: string;
    column: PostKey;
    sort: { key: PostKey; dir: SortDir };
    onSort: (key: PostKey) => void;
    numeric?: boolean;
    className?: string;
}) {
    const active = sort.key === column;
    const Icon = sort.dir === "asc" ? ArrowUp : ArrowDown;
    return (
        <TableHead
            aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
            className={cn("text-ink-3 text-xs font-medium", numeric && "text-right", className)}
        >
            <button
                type="button"
                onClick={() => onSort(column)}
                className={cn(
                    "hover:text-ink focus-visible:ring-brand/50 inline-flex items-center gap-1 rounded-sm outline-none focus-visible:ring-2",
                    active && "text-ink"
                )}
            >
                {label}
                <Icon className={cn("size-3", !active && "invisible")} aria-hidden />
            </button>
        </TableHead>
    );
}

/** A channel total, or "—" when none of its posts report that number. */
function channelValue(
    channel: InsightsChannel,
    posts: BrandPost[],
    key: "impressions" | "clicks",
    value: number,
    count: (n: number) => string
): string {
    const mine = posts.filter(p => p.channelId === channel.channelId);
    if (mine.length > 0 && mine.every(p => p.metrics?.[key] === null || !p.metrics)) return "—";
    return count(value);
}

/**
 * How the posts did: totals for the range, each channel, each post. Numbers
 * come from the networks as of the last sync; "Sync now" reads them again.
 * A number a network does not report is "—", never 0.
 */
export function AnalyticsScreen() {
    const t = useTranslations("growth.brand");
    const tc = useTranslations("growth.common.counts");
    const tAction = useTranslations("common.actions");
    const { compact, count, shortDate } = useGrowthFormat();
    const paths = useGrowthPaths();
    const router = useToolRouter();
    const pathname = useToolPathname();
    const params = useToolSearchParams();
    const asked = Number(params.get("days"));
    const days: Range = isRange(asked) ? asked : DEFAULT_RANGE;

    const accounts = useResource("brand:accounts", () => brandApi.accounts());
    const res = useResource(`brand:insights:${days}`, () => brandApi.insights({ days }));
    const reload = res.reload;
    const sync = useBrandSync(
        useCallback(async () => {
            await reload();
        }, [reload])
    );
    const [sort, setSort] = useState<{ key: PostKey; dir: SortDir }>({
        key: "published",
        dir: "desc",
    });

    const setDays = (value: Range) => {
        const next = new URLSearchParams(params.toString());
        if (value === DEFAULT_RANGE) next.delete("days");
        else next.set("days", String(value));
        const s = next.toString();
        router.replace(s ? `${pathname}?${s}` : pathname);
    };
    const onSort = (key: PostKey) =>
        setSort(current =>
            current.key === key
                ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
                : { key, dir: key === "excerpt" || key === "channel" ? "asc" : "desc" }
        );

    const data = res.data;
    const posts = useMemo(
        () => (data ? sortRows(data.posts, POST_VALUE[sort.key], sort.dir) : []),
        [data, sort]
    );
    const channels = useMemo(
        () => (data ? sortRows(data.channels, c => c.impressions, "desc") : []),
        [data]
    );
    const reporting = (accounts.data?.channels ?? []).filter(c => c.capabilities.analytics);
    const noAnalytics = accounts.data !== null && reporting.length === 0;
    const neverSynced = data !== null && data.syncedAt === null;
    const totals = data?.totals;

    return (
        <div className="mx-auto flex max-w-[1200px] flex-col gap-7">
            <PageHeader
                size="md"
                title={t("analytics.title")}
                sub={
                    data ? (
                        <>
                            <SyncedAt at={data.syncedAt} /> ·{" "}
                            {t("analytics.range", {
                                from: shortDate(data.from),
                                to: shortDate(data.to),
                            })}
                        </>
                    ) : undefined
                }
                actions={
                    <>
                        <ToggleGroup
                            type="single"
                            value={String(days)}
                            onValueChange={v => {
                                const n = Number(v);
                                if (isRange(n)) setDays(n);
                            }}
                            size="sm"
                            className="border-line bg-panel gap-0.5 rounded-md border p-0.5"
                            aria-label={t("analytics.rangeAria")}
                        >
                            {RANGES.map(r => (
                                <ToggleGroupItem
                                    key={r}
                                    value={String(r)}
                                    className="data-[state=on]:shadow-1 h-7 rounded-[5px] px-2.5 text-xs"
                                >
                                    {t("analytics.days", { count: r })}
                                </ToggleGroupItem>
                            ))}
                        </ToggleGroup>
                        <SyncButton
                            onClick={() => void sync.run()}
                            busy={sync.busy}
                            disabled={accounts.data?.canPublish === false}
                        />
                    </>
                }
            />
            <SyncProblems errors={sync.errors} failure={sync.failure} />
            {res.error && <InlineError message={res.error} onRetry={() => void res.reload()} />}

            {noAnalytics ? (
                <EmptyState
                    title={t("analytics.noAnalytics")}
                    body={t("analytics.noAnalyticsBody")}
                    action={
                        <Button asChild size="sm">
                            <ToolLink href={paths.brand("/accounts")}>
                                {t("common.openAccounts")}
                            </ToolLink>
                        </Button>
                    }
                />
            ) : neverSynced ? (
                <EmptyState
                    title={t("analytics.neverSynced")}
                    body={t("analytics.neverSyncedBody")}
                    action={
                        <SyncButton
                            onClick={() => void sync.run()}
                            busy={sync.busy}
                            disabled={accounts.data?.canPublish === false}
                        />
                    }
                />
            ) : (
                <>
                    <StatStrip
                        label={t("analytics.lastDays", { count: days })}
                        loading={res.loading}
                        stats={[
                            { label: t("stats.posts"), value: count(totals?.posts) },
                            { label: t("stats.impressions"), value: compact(totals?.impressions) },
                            { label: t("stats.reactions"), value: compact(totals?.reactions) },
                            { label: t("stats.comments"), value: compact(totals?.comments) },
                            { label: t("stats.shares"), value: compact(totals?.shares) },
                            { label: t("stats.clicks"), value: compact(totals?.clicks) },
                            { label: t("stats.engagement"), value: percent(totals?.engagement) },
                        ]}
                    />

                    <section>
                        <SectionHeading
                            title={t("common.channels")}
                            aside={data ? tc("channels", { count: channels.length }) : undefined}
                        />
                        {res.loading ? (
                            <SkeletonRows rows={3} height={48} />
                        ) : (
                            <div className="border-line bg-panel overflow-x-auto rounded-lg border">
                                <Table className="text-[13px]">
                                    <TableHeader>
                                        <TableRow className="hover:bg-transparent">
                                            <TableHead className="text-ink-3 pl-4 text-xs font-medium">
                                                {t("common.channel")}
                                            </TableHead>
                                            {[
                                                t("stats.followers"),
                                                t("stats.posts"),
                                                t("stats.impressions"),
                                                t("stats.reactions"),
                                                t("stats.comments"),
                                                t("stats.shares"),
                                                t("stats.clicks"),
                                            ].map(h => (
                                                <TableHead
                                                    key={h}
                                                    className="text-ink-3 text-right text-xs font-medium last:pr-4"
                                                >
                                                    {h}
                                                </TableHead>
                                            ))}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {channels.map(c => (
                                            <TableRow key={c.channelId}>
                                                <TableCell className="pl-4">
                                                    <span className="inline-flex items-center gap-2">
                                                        <ChannelAvatar
                                                            name={c.name}
                                                            kind={c.kind}
                                                            avatarUrl={c.avatarUrl}
                                                            size={22}
                                                        />
                                                        <span className="text-ink">{c.name}</span>
                                                        <span className="text-ink-3 text-xs">
                                                            {t(`kinds.${c.kind}`)} ·{" "}
                                                            {NETWORK_LABEL[c.platform]}
                                                        </span>
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums">
                                                    {count(c.followers)}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums">
                                                    {count(c.posts)}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums">
                                                    {channelValue(
                                                        c,
                                                        data?.posts ?? [],
                                                        "impressions",
                                                        c.impressions,
                                                        count
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums">
                                                    {count(c.reactions)}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums">
                                                    {count(c.comments)}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums">
                                                    {count(c.shares)}
                                                </TableCell>
                                                <TableCell className="pr-4 text-right tabular-nums">
                                                    {channelValue(
                                                        c,
                                                        data?.posts ?? [],
                                                        "clicks",
                                                        c.clicks,
                                                        count
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </section>

                    <section>
                        <SectionHeading
                            title={t("stats.posts")}
                            aside={
                                data
                                    ? t("analytics.postsAside", { count: data.posts.length, days })
                                    : undefined
                            }
                        />
                        {res.loading ? (
                            <SkeletonRows rows={5} height={48} />
                        ) : posts.length === 0 ? (
                            <EmptyState
                                title={t("analytics.nothingPublished", { days })}
                                body={t("analytics.nothingPublishedBody")}
                                action={
                                    <Button asChild size="sm" variant="outline">
                                        <ToolLink href={paths.brand("/compose")}>
                                            {t("common.composeAPost")}
                                        </ToolLink>
                                    </Button>
                                }
                            />
                        ) : (
                            <div className="border-line bg-panel overflow-x-auto rounded-lg border">
                                <Table className="text-[13px]">
                                    <TableHeader>
                                        <TableRow className="hover:bg-transparent">
                                            <SortHead
                                                label={t("common.post")}
                                                column="excerpt"
                                                sort={sort}
                                                onSort={onSort}
                                                numeric={false}
                                                className="pl-4"
                                            />
                                            <SortHead
                                                label={t("common.channel")}
                                                column="channel"
                                                sort={sort}
                                                onSort={onSort}
                                                numeric={false}
                                            />
                                            <SortHead
                                                label={t("common.published")}
                                                column="published"
                                                sort={sort}
                                                onSort={onSort}
                                                numeric={false}
                                            />
                                            <SortHead
                                                label={t("stats.impressions")}
                                                column="impressions"
                                                sort={sort}
                                                onSort={onSort}
                                            />
                                            <SortHead
                                                label={t("stats.reactions")}
                                                column="reactions"
                                                sort={sort}
                                                onSort={onSort}
                                            />
                                            <SortHead
                                                label={t("stats.comments")}
                                                column="comments"
                                                sort={sort}
                                                onSort={onSort}
                                            />
                                            <SortHead
                                                label={t("stats.shares")}
                                                column="shares"
                                                sort={sort}
                                                onSort={onSort}
                                            />
                                            <SortHead
                                                label={t("stats.clicks")}
                                                column="clicks"
                                                sort={sort}
                                                onSort={onSort}
                                            />
                                            <SortHead
                                                label={t("stats.engagement")}
                                                column="engagement"
                                                sort={sort}
                                                onSort={onSort}
                                            />
                                            <TableHead className="w-10 pr-4">
                                                <span className="sr-only">{tAction("open")}</span>
                                            </TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {posts.map(p => (
                                            <TableRow key={p.id}>
                                                <TableCell className="max-w-[300px] pl-4">
                                                    <span className="text-ink block truncate">
                                                        {p.body}
                                                    </span>
                                                </TableCell>
                                                <TableCell>
                                                    <ChannelLabel
                                                        channel={p.channel}
                                                        platform={p.platform}
                                                        size={18}
                                                        showKind={false}
                                                        className="max-w-[180px]"
                                                    />
                                                </TableCell>
                                                <TableCell className="text-ink-2 tabular-nums">
                                                    {shortDate(p.publishedAt)}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums">
                                                    {count(p.metrics?.impressions)}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums">
                                                    {count(p.metrics?.reactions)}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums">
                                                    {count(p.metrics?.comments)}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums">
                                                    {count(p.metrics?.shares)}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums">
                                                    {count(p.metrics?.clicks)}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums">
                                                    {percent(engagementOf(p.metrics))}
                                                </TableCell>
                                                <TableCell className="pr-4 text-right">
                                                    {p.postUrl && (
                                                        <a
                                                            href={p.postUrl}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            aria-label={t("common.openOn", {
                                                                network: NETWORK_LABEL[p.platform],
                                                            })}
                                                            title={t("common.openOn", {
                                                                network: NETWORK_LABEL[p.platform],
                                                            })}
                                                            className="text-ink-3 hover:text-ink focus-visible:ring-brand/50 inline-flex rounded-sm outline-none focus-visible:ring-2"
                                                        >
                                                            <ExternalLink
                                                                className="size-3.5"
                                                                aria-hidden
                                                            />
                                                        </a>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </section>
                </>
            )}
        </div>
    );
}
