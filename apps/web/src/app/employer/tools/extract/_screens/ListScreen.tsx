"use client";

import { Plus } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";

import { ToolLink } from "~/components/tool-app/ToolLink";
import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { PageHeader } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Progress } from "~/components/ui/progress";
import type { ExtractionTableSummary } from "~/lib/extraction/types";

import { StatusPill } from "../_components/Bits";
import { TableMenu } from "../_components/TableMenu";
import { isLive, progressOf } from "../_lib/cells";
import { useExtract } from "../_lib/context";
import { tablePath } from "../_lib/screens";

/**
 * Every table this member made, and the ones others shared with the
 * workspace, newest first. A table still being read says how far it is and
 * the list keeps polling until it is done.
 */
export function ListScreen() {
    const t = useTranslations("extract.list");
    const { list } = useExtract();
    const tables = list.data?.tables ?? [];
    const newButton = (
        <Button asChild size="sm">
            <ToolLink href="/new">
                <Plus aria-hidden />
                {t("newTable")}
            </ToolLink>
        </Button>
    );

    return (
        <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
            <PageHeader
                title={t("title")}
                accent={t("accent")}
                sub={t("sub")}
                actions={tables.length > 0 ? newButton : undefined}
            />
            {list.error && <InlineError message={list.error} onRetry={() => void list.reload()} />}
            {list.loading ? (
                <SkeletonRows rows={4} height={64} />
            ) : tables.length === 0 && !list.error ? (
                <EmptyState title={t("emptyTitle")} body={t("emptyBody")} action={newButton} />
            ) : (
                <ul className="border-line bg-panel overflow-hidden rounded-lg border">
                    {tables.map(table => (
                        <TableRow key={table.id} table={table} />
                    ))}
                </ul>
            )}
        </div>
    );
}

function TableRow({ table }: { table: ExtractionTableSummary }) {
    const t = useTranslations("extract.list");
    const tw = useTranslations("extract.words");
    const { list } = useExtract();
    const format = useFormatter();
    const now = useNow();
    const when = format.relativeTime(new Date(table.createdAt), now);
    const live = isLive(table.status);
    const { percent } = progressOf(table.counts);
    const reload = () => void list.reload();
    return (
        <li className="border-line-2 hover:bg-panel-2 flex items-stretch border-t first:border-t-0">
            <ToolLink
                href={tablePath(table.id)}
                className="focus-visible:ring-brand/50 @max-sm:grid-cols-1 grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-1.5 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-inset"
            >
                <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                        <span className="text-ink truncate text-sm font-medium">{table.title}</span>
                        {table.shared && (
                            <Badge variant="secondary" className="shrink-0">
                                {t("shared")}
                            </Badge>
                        )}
                    </div>
                    <p className="text-ink-3 mt-0.5 truncate text-xs tabular-nums">
                        {tw("size", { documents: table.counts.total, fields: table.fieldCount })}
                        <span aria-hidden> · </span>
                        {table.mine || !table.createdByName
                            ? when
                            : t("byWhen", { name: table.createdByName, when })}
                    </p>
                </div>
                <div className="@max-sm:items-start flex flex-col items-end gap-1.5">
                    <StatusPill table={table} />
                    {live && (
                        <Progress
                            value={percent}
                            className="h-1 w-28"
                            aria-label={tw("progressAria", { title: table.title })}
                        />
                    )}
                </div>
            </ToolLink>
            {table.mine && (
                <div className="flex shrink-0 items-center pr-2">
                    <TableMenu table={table} onChanged={reload} onDeleted={reload} />
                </div>
            )}
        </li>
    );
}
