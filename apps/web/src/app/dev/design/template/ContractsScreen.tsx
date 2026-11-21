"use client";

import { MoreHorizontal, Plus, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { useActionMenu, useContextTarget } from "~/components/context-menu";
import { useToolNav } from "~/components/tool-app/nav";
import { ToolLink } from "~/components/tool-app/ToolLink";
import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { PageHeader } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import type { ActionMenuItem } from "~/components/ui/action-menu";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "~/components/ui/table";

import { useContractActions } from "./actions";
import { paths, StatusBadge, useRenewalsFormat } from "./bits";
import { useContracts, type Contract, type ContractStatus } from "./data";
import { buildContractMenuItems } from "./menu";

const STATUSES: ContractStatus[] = ["decide", "auto", "renewing", "ending"];

/**
 * A list of things you compare across columns: the kit `Table`. (A list you
 * scan by name, one line each, is the bordered row list on the Overview.)
 *
 * - Filters sit in one row above the table, on its left edge.
 * - Headers are quiet (`text-ink-3 text-xs`); numbers right-aligned in
 *   tabular figures; status a `Badge`.
 * - The name is the link; the whole row also opens on click.
 * - Each row's verbs are one menu, opened by right-click or its "⋯".
 * - Columns that matter least drop as the tab narrows (`@max-md:hidden`),
 *   by the tab's width, never the window's.
 */
export function ContractsScreen() {
    const t = useTranslations("designTemplate.contracts");
    const tOverview = useTranslations("designTemplate.overview");
    const tStatus = useTranslations("designTemplate.status");
    const tContract = useTranslations("designTemplate.contract");
    const tc = useTranslations("common");
    const contracts = useContracts();
    const { navigate } = useToolNav();
    const actions = useContractActions();
    const [query, setQuery] = useState("");
    const [status, setStatus] = useState<ContractStatus | "all">("all");

    const list = useMemo(() => contracts.data ?? [], [contracts.data]);
    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        return list.filter(
            c =>
                (status === "all" || c.status === status) &&
                (!q || c.vendor.toLowerCase().includes(q) || c.owner.toLowerCase().includes(q))
        );
    }, [list, query, status]);
    const sources = new Set(list.map(c => c.source.title)).size;

    const menuFor = (c: Contract): ActionMenuItem[] =>
        buildContractMenuItems(
            c,
            {
                onOpen: () => navigate(paths.contract(c.id)),
                onDecide: () => navigate(`${paths.contract(c.id)}?decide=1`),
                onAsk: () => actions.ask(c),
                onCopyLink: () => actions.copyLink(c),
                onDelete: () => actions.requestDelete(c),
            },
            tContract
        );

    const newButton = (
        <Button asChild size="sm">
            <ToolLink href={paths.create()}>
                <Plus />
                {tOverview("newRenewal")}
            </ToolLink>
        </Button>
    );

    let body: React.ReactNode;
    if (contracts.status === "error") {
        body = <InlineError message={t("loadFailed")} onRetry={contracts.retry} />;
    } else if (contracts.status === "ready" && list.length === 0) {
        body = (
            <EmptyState
                title={tOverview("emptyTitle")}
                body={tOverview("emptyBody")}
                action={newButton}
            />
        );
    } else {
        body = (
            <>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative w-64 max-w-full">
                        <Search
                            aria-hidden
                            className="text-ink-3 pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2"
                        />
                        <Input
                            type="search"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder={t("search")}
                            aria-label={t("search")}
                            className="h-8 pl-8 text-[13px]"
                        />
                    </div>
                    <Select
                        value={status}
                        onValueChange={v => setStatus(v as ContractStatus | "all")}
                    >
                        <SelectTrigger
                            size="sm"
                            aria-label={t("statusFilter")}
                            className="w-48 text-[13px]"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">{t("allStatuses")}</SelectItem>
                            {STATUSES.map(s => (
                                <SelectItem key={s} value={s}>
                                    {tStatus(s)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {contracts.status === "loading" ? (
                    <SkeletonRows rows={6} height={45} />
                ) : shown.length === 0 ? (
                    // Filtered to nothing is not "empty": say so, and offer the way back.
                    <EmptyState
                        title={t("noMatchTitle")}
                        body={t("noMatchBody", { query: query.trim() || "…" })}
                        action={
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                    setQuery("");
                                    setStatus("all");
                                }}
                            >
                                {t("clearFilters")}
                            </Button>
                        }
                    />
                ) : (
                    <div className="border-line bg-panel overflow-hidden rounded-lg border">
                        <Table>
                            <TableHeader>
                                <TableRow className="hover:bg-transparent">
                                    <TableHead className="text-ink-3 pl-4 text-xs">
                                        {t("columns.vendor")}
                                    </TableHead>
                                    <TableHead className="text-ink-3 @max-md:hidden text-xs">
                                        {t("columns.owner")}
                                    </TableHead>
                                    <TableHead className="text-ink-3 text-xs">
                                        {t("columns.renews")}
                                    </TableHead>
                                    <TableHead className="text-ink-3 @max-md:hidden text-right text-xs">
                                        {t("columns.value")}
                                    </TableHead>
                                    <TableHead className="text-ink-3 @max-sm:hidden text-xs">
                                        {t("columns.status")}
                                    </TableHead>
                                    <TableHead className="w-10">
                                        <span className="sr-only">{tc("actions.moreActions")}</span>
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {shown.map(c => (
                                    <ContractRow key={c.id} contract={c} items={() => menuFor(c)} />
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </>
        );
    }

    return (
        <div className="mx-auto flex max-w-[1080px] flex-col gap-5">
            <PageHeader
                title={t("title")}
                sub={
                    contracts.status === "ready" ? (
                        t("sub", { count: list.length, sources })
                    ) : (
                        <Skeleton className="h-3 w-48" />
                    )
                }
                actions={newButton}
            />
            {body}
        </div>
    );
}

/**
 * One row. Its own component so it can declare itself a right-click target
 * with `useContextTarget` — a wrapper element is not allowed inside `<tbody>`.
 */
function ContractRow({
    contract: c,
    items,
}: {
    contract: Contract;
    items: () => ActionMenuItem[];
}) {
    const t = useTranslations("designTemplate.contracts");
    const f = useRenewalsFormat();
    const { navigate } = useToolNav();
    const menu = useActionMenu();
    const target = useContextTarget({
        kind: "template-contract",
        id: c.id,
        label: c.vendor,
        items,
    });
    return (
        <TableRow
            {...target}
            className="cursor-pointer"
            onClick={event => {
                if ((event.target as Element).closest("a,button")) return;
                navigate(paths.contract(c.id));
            }}
        >
            <TableCell className="pl-4">
                <ToolLink
                    href={paths.contract(c.id)}
                    className="text-ink focus-visible:ring-brand/50 rounded-sm font-medium no-underline outline-none hover:underline focus-visible:ring-2"
                >
                    {c.vendor}
                </ToolLink>
            </TableCell>
            <TableCell className="text-ink-2 @max-md:hidden">{c.owner}</TableCell>
            <TableCell className="text-ink-2 tabular-nums">{f.dayMonth(c.renewsOn)}</TableCell>
            <TableCell className="text-ink-2 @max-md:hidden text-right tabular-nums">
                {c.value ? f.money(c.value) : "—"}
            </TableCell>
            <TableCell className="@max-sm:hidden">
                <StatusBadge status={c.status} />
            </TableCell>
            <TableCell className="pr-2 text-right">
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={t("rowActions", { vendor: c.vendor })}
                    onClick={event => {
                        const box = event.currentTarget.getBoundingClientRect();
                        menu.open({
                            x: box.left,
                            y: box.bottom + 4,
                            items: items(),
                            ariaLabel: c.vendor,
                            via: "button",
                            kind: "template-contract",
                        });
                    }}
                >
                    <MoreHorizontal />
                </Button>
            </TableCell>
        </TableRow>
    );
}
