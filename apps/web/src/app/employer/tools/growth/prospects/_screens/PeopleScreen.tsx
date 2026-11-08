"use client";

import { ArrowDown, ArrowUp, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ToolLink } from "~/components/tool-app/ToolLink";

import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "~/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";

import { prospectsApi, type EmailStatusKind, type PersonRow } from "../api";
import { useCopyText, type CopyText } from "~/lib/tools/copyText";
import { useProspects } from "../_lib/context";
import { useErrorText } from "~/lib/tools/errorText";
import { useResource } from "~/lib/tools/useResource";
import { BulkBar } from "../_components/BulkBar";
import { EMAIL_STATUSES, EmailStatus, canOutreach } from "../_components/EmailStatus";
import { EmptyState, InlineError } from "~/components/tools/EmptyState";
import { PageHeader } from "~/components/tools/PageHeader";
import { SkeletonRows } from "~/components/tools/SkeletonRows";

const STATUSES: ReadonlyArray<"all" | EmailStatusKind> = ["all", ...EMAIL_STATUSES];
type PeopleSort = "name" | "company";
type SortDir = "asc" | "desc";

function SortHead({
    label,
    active,
    dir,
    onClick,
}: {
    label: string;
    active: boolean;
    dir: SortDir;
    onClick: () => void;
}) {
    const Icon = dir === "asc" ? ArrowUp : ArrowDown;
    return (
        <TableHead aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
            <button
                type="button"
                onClick={onClick}
                className="text-ink-3 hover:text-ink inline-flex items-center gap-1 text-xs font-medium"
            >
                {label}
                {active && <Icon className="size-3" aria-hidden />}
            </button>
        </TableHead>
    );
}

function sortValue(person: PersonRow, sort: PeopleSort, word: CopyText): string {
    if (sort === "name") return word(person.nameCopy, person.name);
    return person.companyName;
}

export function PeopleScreen() {
    const t = useTranslations("growth.prospects");
    const tc = useTranslations("common");
    const word = useCopyText();
    const errorText = useErrorText();
    const { segmentId, href } = useProspects();
    const [status, setStatus] = useState<"all" | EmailStatusKind>("all");
    const [sort, setSort] = useState<PeopleSort>("name");
    const [dir, setDir] = useState<SortDir>("asc");
    const chooseSort = (next: PeopleSort) => {
        if (next === sort) setDir(current => (current === "asc" ? "desc" : "asc"));
        else {
            setSort(next);
            setDir("asc");
        }
    };
    const [q, setQ] = useState("");
    const [debounced, setDebounced] = useState("");
    useEffect(() => {
        const id = window.setTimeout(() => setDebounced(q), 220);
        return () => window.clearTimeout(id);
    }, [q]);

    const res = useResource(segmentId ? `people:${segmentId}:${status}:${debounced}` : null, () =>
        prospectsApi.people({
            segmentId: segmentId!,
            q: debounced || undefined,
            status: status === "all" ? undefined : status,
        })
    );
    const people = useMemo(() => {
        const rows = res.data?.people ?? [];
        return [...rows].sort((a, b) => {
            const left = sortValue(a, sort, word);
            const right = sortValue(b, sort, word);
            if (!left && right) return 1;
            if (left && !right) return -1;
            const compared = left.localeCompare(right, undefined, { sensitivity: "base" });
            return dir === "asc" ? compared : -compared;
        });
    }, [res.data, sort, dir, word]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    useEffect(() => setSelected(new Set()), [status, debounced, segmentId]);

    const outreach = async () => {
        const ids = [...selected];
        try {
            const result = await prospectsApi.outreach({ personIds: ids });
            toast.success(
                result.skipped.length
                    ? t("people.draftedSkipped", {
                          count: result.people,
                          skipped: result.skipped.length,
                      })
                    : t("people.drafted", { count: result.people })
            );
            setSelected(new Set());
        } catch (e) {
            toast.error(errorText(e, t("common.outreachFailed")));
        }
    };

    const eligible = people.filter(p => canOutreach(p.emailStatus) && !p.blockedReason);

    return (
        <div className="mx-auto flex max-w-[1180px] flex-col gap-5">
            <PageHeader
                size="md"
                title={t("common.people")}
                sub={
                    res.data
                        ? t("people.sub", { count: people.length, eligible: eligible.length })
                        : undefined
                }
            />
            <div className="flex flex-wrap items-center gap-2.5">
                <ToggleGroup
                    type="single"
                    value={status}
                    onValueChange={v => v && setStatus(v as typeof status)}
                    size="sm"
                    className="border-line bg-panel max-w-full justify-start gap-0.5 overflow-x-auto rounded-md border p-0.5"
                    aria-label={t("people.statusAria")}
                >
                    {STATUSES.map(s => (
                        <ToggleGroupItem
                            key={s}
                            value={s}
                            className="h-7 shrink-0 rounded-[5px] px-2.5 text-xs"
                        >
                            {s === "all" ? tc("status.all") : t(`emailStatus.label.${s}`)}
                        </ToggleGroupItem>
                    ))}
                </ToggleGroup>
                <Input
                    value={q}
                    onChange={e => setQ(e.target.value)}
                    placeholder={t("people.searchPlaceholder")}
                    aria-label={t("people.searchAria")}
                    className="ml-auto h-8 w-[260px] text-[13px]"
                />
            </div>

            {res.error && <InlineError message={res.error} onRetry={() => void res.reload()} />}

            {res.loading ? (
                <SkeletonRows rows={8} height={48} />
            ) : people.length === 0 ? (
                <EmptyState
                    title={t("people.empty")}
                    body={t("people.emptyBody")}
                    action={
                        <Button variant="outline" size="sm" asChild>
                            <ToolLink href={href("/companies")}>
                                {t("people.openCompanies")}
                            </ToolLink>
                        </Button>
                    }
                />
            ) : (
                <div className="border-line bg-panel overflow-x-auto rounded-lg border">
                    <Table className="text-[13px]">
                        <TableHeader>
                            <TableRow className="hover:bg-transparent">
                                <TableHead className="w-9 pl-3">
                                    <Checkbox
                                        aria-label={t("people.selectAllEligible")}
                                        checked={
                                            eligible.length > 0 &&
                                            eligible.every(p => selected.has(p.id))
                                        }
                                        onCheckedChange={checked =>
                                            setSelected(
                                                checked
                                                    ? new Set(eligible.map(p => p.id))
                                                    : new Set()
                                            )
                                        }
                                    />
                                </TableHead>
                                <SortHead
                                    label={t("people.person")}
                                    active={sort === "name"}
                                    dir={dir}
                                    onClick={() => chooseSort("name")}
                                />
                                <SortHead
                                    label={t("common.company")}
                                    active={sort === "company"}
                                    dir={dir}
                                    onClick={() => chooseSort("company")}
                                />
                                <TableHead className="text-ink-3 text-xs font-medium">
                                    {tc("fields.email")}
                                </TableHead>
                                <TableHead className="text-ink-3 text-xs font-medium">
                                    {t("common.source")}
                                </TableHead>
                                <TableHead className="text-ink-3 text-xs font-medium">
                                    {t("company.linkedinLink")}
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {people.map(p => {
                                const ok = canOutreach(p.emailStatus) && !p.blockedReason;
                                const name = word(p.nameCopy, p.name);
                                const source = word(p.sourceCopy, p.source);
                                return (
                                    <TableRow
                                        key={p.id}
                                        data-state={selected.has(p.id) ? "selected" : undefined}
                                    >
                                        <TableCell className="pl-3">
                                            <Checkbox
                                                aria-label={t("common.select", { name })}
                                                checked={selected.has(p.id)}
                                                disabled={!ok}
                                                onCheckedChange={checked =>
                                                    setSelected(prev => {
                                                        const next = new Set(prev);
                                                        if (checked) next.add(p.id);
                                                        else next.delete(p.id);
                                                        return next;
                                                    })
                                                }
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <span className="flex items-center gap-2.5">
                                                <Avatar className="size-7">
                                                    <AvatarFallback>{p.initials}</AvatarFallback>
                                                </Avatar>
                                                <span className="min-w-0">
                                                    <span className="text-ink block truncate font-medium">
                                                        {name}
                                                    </span>
                                                    <span className="text-ink-3 block truncate text-xs">
                                                        {word(p.titleCopy, p.title)} · {p.seniority}
                                                    </span>
                                                </span>
                                            </span>
                                        </TableCell>
                                        <TableCell>
                                            <ToolLink
                                                href={href(`/companies/${p.companyId}`)}
                                                className="text-ink hover:underline"
                                            >
                                                {p.companyName}
                                            </ToolLink>
                                            {p.blockedReason && (
                                                <span className="text-ink-3 block text-xs">
                                                    {word(p.blockedReasonCopy, p.blockedReason)}
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <span className="flex items-center gap-2">
                                                <span className="text-ink-2 truncate font-mono text-[12px]">
                                                    {p.email ?? "—"}
                                                </span>
                                                <EmailStatus status={p.emailStatus} />
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-ink-3 text-xs">
                                            {source}
                                        </TableCell>
                                        <TableCell className="text-xs">
                                            {p.sourceUrl?.includes("linkedin.com") ? (
                                                <a
                                                    href={p.sourceUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="text-ink-2 inline-flex max-w-full items-center gap-1 underline underline-offset-2"
                                                >
                                                    <span className="truncate">
                                                        {t("company.linkedinLink")}
                                                    </span>
                                                    <ExternalLink
                                                        className="size-3 shrink-0"
                                                        aria-hidden
                                                    />
                                                </a>
                                            ) : p.emailStatus ===
                                              "generic" ? null : p.linkedinSearchUrl ? (
                                                <a
                                                    href={p.linkedinSearchUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="text-ink-2 inline-flex max-w-full items-center gap-1 underline underline-offset-2"
                                                >
                                                    <span className="truncate">
                                                        {t("company.openLinkedIn")}
                                                    </span>
                                                    <ExternalLink
                                                        className="size-3 shrink-0"
                                                        aria-hidden
                                                    />
                                                </a>
                                            ) : (
                                                <span className="text-ink-4">
                                                    {t("company.noLinkedIn")}
                                                </span>
                                            )}
                                            {p.linkedinStatus &&
                                                p.linkedinStatus !== "search_error" &&
                                                p.emailStatus !== "generic" && (
                                                    <span className="text-ink-4 mt-0.5 block text-[11px]">
                                                        {t(
                                                            `company.linkedinStatus.${p.linkedinStatus}`
                                                        )}
                                                    </span>
                                                )}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            )}

            <BulkBar count={selected.size} onClear={() => setSelected(new Set())}>
                <Button size="sm" onClick={() => void outreach()}>
                    {t("common.addToOutreach")}
                </Button>
            </BulkBar>
        </div>
    );
}
