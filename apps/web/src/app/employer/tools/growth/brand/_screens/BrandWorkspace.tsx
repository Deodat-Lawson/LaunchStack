"use client";

import { ChevronLeft, ChevronRight, Megaphone } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";

import { InlineError } from "~/components/tools/EmptyState";
import { ToolHeader, ToolPage } from "../../_components/ToolHeader";
import { plural } from "~/lib/tools/format";
import { useGrowthUrls } from "../../_lib/paths";
import { useResource } from "~/lib/tools/useResource";
import { AccountsPanel } from "../_components/AccountsPanel";
import { ComposePanel } from "../_components/ComposePanel";
import { NetworkMark } from "../_components/NetworkMark";
import { PostLists } from "../_components/PostLists";
import { WeekCalendar } from "../_components/WeekCalendar";
import {
    DAY,
    addDays,
    dayNumber,
    isDue,
    monthYear,
    parseDateKey,
    sameDay,
    startOfWeek,
    toDateKey,
} from "../_lib/time";
import { BRAND_PLATFORMS, brandApi } from "../api";

type BrandPanel = "compose" | "accounts";

function isPanel(value: string | null): value is BrandPanel {
    return value === "compose" || value === "accounts";
}

/** True when the key press should be left to the control that has focus. */
function inEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target.isContentEditable ||
        target.closest("[contenteditable=true]") !== null
    );
}

/**
 * Brand as one tool page: the header, a week of the calendar, and the
 * three lists that tell the week's story under it. Composing and the
 * accounts open as panels over the calendar, spelled in the URL
 * (`?panel=compose|accounts`); the week shown is `?week=YYYY-MM-DD`, its
 * Monday, omitted for the current week.
 */
export function BrandWorkspace() {
    const router = useRouter();
    const pathname = usePathname();
    const params = useSearchParams();
    const urls = useGrowthUrls();

    const weekParam = params.get("week");
    const weekStart = useMemo(
        () => startOfWeek(parseDateKey(weekParam) ?? new Date()),
        [weekParam]
    );
    const panelParam = params.get("panel");
    const panel: BrandPanel | null = isPanel(panelParam) ? panelParam : null;

    const setParams = useCallback(
        (patch: Record<string, string | null>) => {
            const next = new URLSearchParams(params.toString());
            for (const [key, value] of Object.entries(patch)) {
                if (value === null || value === "") next.delete(key);
                else next.set(key, value);
            }
            const s = next.toString();
            router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
        },
        [params, pathname, router]
    );
    const showWeek = useCallback(
        (day: Date) => {
            const monday = startOfWeek(day);
            const current = sameDay(monday, startOfWeek(new Date()));
            setParams({ week: current ? null : toDateKey(monday) });
        },
        [setParams]
    );
    const setPanel = useCallback(
        (next: BrandPanel | null) => setParams({ panel: next }),
        [setParams]
    );

    // The posts for the week on screen plus the lists' window under it, in
    // one request, kept fresh on a slow poll.
    const [mountedAt] = useState(() => Date.now());
    const range = useMemo(() => {
        const from = Math.min(weekStart.getTime(), mountedAt - 7 * DAY);
        const to = Math.max(addDays(weekStart, 7).getTime(), mountedAt + 14 * DAY);
        return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
    }, [weekStart, mountedAt]);
    const posts = useResource(
        `brand:posts:${range.from}:${range.to}`,
        () => brandApi.posts({ from: range.from, to: range.to }),
        { pollMs: 30_000 }
    );
    const accounts = useResource("brand:accounts", () => brandApi.accounts());

    const list = useMemo(() => posts.data?.posts ?? [], [posts.data]);
    const due = list.filter(p => isDue(p));
    const accountList = accounts.data?.accounts ?? null;
    const connected = (accountList ?? []).filter(a => a.configured).length;
    const revoked = (accountList ?? []).filter(a => a.status === "revoked").length;
    const anyRevoked = revoked > 0;
    const networkCount = accountList?.length ?? BRAND_PLATFORMS.length;
    const configured = useMemo(
        () => new Set((accountList ?? []).filter(a => a.configured).map(a => a.platform)),
        [accountList]
    );

    const today = new Date();
    const thisWeek = sameDay(startOfWeek(today), weekStart);

    // `c` composes, unless something editable has focus or a panel is open.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "c" || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
            if (panel !== null || inEditableTarget(e.target)) return;
            e.preventDefault();
            setPanel("compose");
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [panel, setPanel]);

    const reloadPosts = posts.reload;
    const reloadAccounts = accounts.reload;
    const afterChange = useCallback(() => void reloadPosts(), [reloadPosts]);
    const afterAccountChange = useCallback(() => {
        void reloadAccounts();
        void reloadPosts();
    }, [reloadAccounts, reloadPosts]);

    const publishDue = async () => {
        try {
            const result = await brandApi.publishDue();
            const n = result.published.length;
            if (n > 0) toast.success(`Published ${plural(n, "overdue post")}`);
            if (result.retrying.length > 0)
                toast(`${plural(result.retrying.length, "post")} will be retried`);
            if (result.failed.length > 0)
                toast.error(`${plural(result.failed.length, "post")} failed; see the calendar`);
            if (n === 0 && result.failed.length === 0 && result.retrying.length === 0)
                toast("Nothing was overdue");
            await posts.reload();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not publish");
        }
    };

    return (
        <ToolPage>
            <ToolHeader
                icon={<Megaphone className="size-5" />}
                title="Brand"
                description="Compose once for every network, schedule it, see the week."
                actions={
                    <>
                        <Button
                            variant="outline"
                            size="sm"
                            className="rounded-full pl-2.5"
                            onClick={() => setPanel("accounts")}
                            aria-label={
                                accountList
                                    ? `Networks: ${connected} of ${networkCount} connected${anyRevoked ? `, ${revoked} need${revoked === 1 ? "s" : ""} reconnecting` : ""}`
                                    : "Networks"
                            }
                        >
                            <span className="flex items-center gap-1" aria-hidden>
                                {BRAND_PLATFORMS.map(platform => (
                                    <NetworkMark
                                        key={platform}
                                        platform={platform}
                                        size={16}
                                        muted={!configured.has(platform)}
                                    />
                                ))}
                            </span>
                            <span className="tabular-nums">
                                {accountList
                                    ? `${connected} of ${networkCount} connected`
                                    : "Networks"}
                            </span>
                            {anyRevoked && (
                                <span className="text-warn text-[11.5px] font-medium">
                                    reconnect
                                </span>
                            )}
                        </Button>
                        <Button asChild variant="outline" size="sm">
                            <Link href={urls.campaigns}>Generate a campaign</Link>
                        </Button>
                        <Button size="sm" onClick={() => setPanel("compose")}>
                            Compose
                        </Button>
                    </>
                }
            />

            <section className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        size="icon"
                        variant="outline"
                        className="size-8"
                        aria-label="Previous week"
                        onClick={() => showWeek(addDays(weekStart, -7))}
                    >
                        <ChevronLeft className="size-4" />
                    </Button>
                    <Button
                        size="icon"
                        variant="outline"
                        className="size-8"
                        aria-label="Next week"
                        onClick={() => showWeek(addDays(weekStart, 7))}
                    >
                        <ChevronRight className="size-4" />
                    </Button>
                    {!thisWeek && (
                        <Button size="sm" variant="ghost" onClick={() => showWeek(new Date())}>
                            This week
                        </Button>
                    )}
                    <span className="text-ink text-[13px] font-medium">{monthYear(weekStart)}</span>
                    <span className="text-ink-3 text-[13px] tabular-nums">
                        week of {dayNumber(weekStart)}–{dayNumber(addDays(weekStart, 6))}
                    </span>
                    {due.length > 0 && (
                        <Button
                            size="sm"
                            variant="outline"
                            className="ml-auto"
                            onClick={() => void publishDue()}
                        >
                            Publish overdue now
                            <span className="text-ink-3 tabular-nums">{due.length}</span>
                        </Button>
                    )}
                </div>

                {posts.error && (
                    <InlineError message={posts.error} onRetry={() => void posts.reload()} />
                )}
                <WeekCalendar
                    weekStart={weekStart}
                    posts={list}
                    loading={posts.loading}
                    onChange={afterChange}
                    onCompose={() => setPanel("compose")}
                />
            </section>

            <div className="mt-2">
                <PostLists
                    posts={list}
                    loading={posts.loading}
                    onChange={afterChange}
                    onCompose={() => setPanel("compose")}
                    campaignsHref={urls.campaigns}
                />
            </div>

            <ComposePanel
                open={panel === "compose"}
                onOpenChange={open => setPanel(open ? "compose" : null)}
                accounts={accountList}
                onSaved={afterChange}
            />
            <AccountsPanel
                open={panel === "accounts"}
                onOpenChange={open => setPanel(open ? "accounts" : null)}
                accounts={accountList}
                loading={accounts.loading}
                error={accounts.error}
                onRetry={() => void accounts.reload()}
                onChanged={afterAccountChange}
            />
        </ToolPage>
    );
}
