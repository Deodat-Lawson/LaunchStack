"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

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

import { prospectsApi, type EmailStatusKind } from "../api";
import { useProspects } from "../_lib/context";
import { useResource } from "../_lib/useResource";
import { BulkBar } from "../_components/BulkBar";
import { EMAIL_STATUS_LABEL, EmailStatus, canOutreach } from "../_components/EmailStatus";
import { EmptyState, InlineError } from "../_components/EmptyState";
import { PageHeader } from "../_components/PageHeader";
import { SkeletonRows } from "../_components/SkeletonRows";

const STATUSES: Array<{ id: "all" | EmailStatusKind; label: string }> = [
    { id: "all", label: "All" },
    { id: "verified", label: EMAIL_STATUS_LABEL.verified },
    { id: "found", label: EMAIL_STATUS_LABEL.found },
    { id: "generic", label: EMAIL_STATUS_LABEL.generic },
    { id: "guess", label: EMAIL_STATUS_LABEL.guess },
];

export function PeopleScreen() {
    const { segmentId, href } = useProspects();
    const [status, setStatus] = useState<"all" | EmailStatusKind>("all");
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
    const people = useMemo(() => res.data?.people ?? [], [res.data]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    useEffect(() => setSelected(new Set()), [status, debounced, segmentId]);

    const outreach = async () => {
        const ids = [...selected];
        try {
            const result = await prospectsApi.outreach({ personIds: ids });
            toast.success(
                `Campaign drafted in Email with ${result.people} ${result.people === 1 ? "person" : "people"}.${result.skipped.length ? ` ${result.skipped.length} skipped.` : ""}`
            );
            setSelected(new Set());
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not draft outreach");
        }
    };

    const eligible = people.filter(p => canOutreach(p.emailStatus) && !p.blockedReason);

    return (
        <div className="mx-auto flex max-w-[1180px] flex-col gap-5">
            <PageHeader
                size="md"
                title="People"
                sub={
                    res.data
                        ? `${people.length} across the segment's companies · ${eligible.length} ready for outreach`
                        : undefined
                }
            />
            <div className="flex flex-wrap items-center gap-2.5">
                <ToggleGroup
                    type="single"
                    value={status}
                    onValueChange={v => v && setStatus(v as typeof status)}
                    size="sm"
                    className="border-line bg-panel gap-0.5 rounded-md border p-0.5"
                    aria-label="Email status"
                >
                    {STATUSES.map(s => (
                        <ToggleGroupItem
                            key={s.id}
                            value={s.id}
                            className="h-7 rounded-[5px] px-2.5 text-xs"
                        >
                            {s.label}
                        </ToggleGroupItem>
                    ))}
                </ToggleGroup>
                <Input
                    value={q}
                    onChange={e => setQ(e.target.value)}
                    placeholder="Search people or companies"
                    aria-label="Search people"
                    className="h-8 w-[260px] text-[13px]"
                />
            </div>

            {res.error && <InlineError message={res.error} onRetry={() => void res.reload()} />}

            {res.loading ? (
                <SkeletonRows rows={8} height={48} />
            ) : people.length === 0 ? (
                <EmptyState
                    title="No people yet"
                    body="People are looked up for the top companies after each run. Run Find companies, or open a company to see who was found."
                    action={
                        <Button variant="outline" size="sm" asChild>
                            <Link href={href("/companies")}>Open companies</Link>
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
                                        aria-label="Select all eligible"
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
                                <TableHead className="text-ink-3 text-xs font-medium">
                                    Person
                                </TableHead>
                                <TableHead className="text-ink-3 text-xs font-medium">
                                    Company
                                </TableHead>
                                <TableHead className="text-ink-3 text-xs font-medium">
                                    Email
                                </TableHead>
                                <TableHead className="text-ink-3 text-xs font-medium">
                                    Source
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {people.map(p => {
                                const ok = canOutreach(p.emailStatus) && !p.blockedReason;
                                return (
                                    <TableRow
                                        key={p.id}
                                        data-state={selected.has(p.id) ? "selected" : undefined}
                                    >
                                        <TableCell className="pl-3">
                                            <Checkbox
                                                aria-label={`Select ${p.name}`}
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
                                                        {p.name}
                                                    </span>
                                                    <span className="text-ink-3 block truncate text-xs">
                                                        {p.title} · {p.seniority}
                                                    </span>
                                                </span>
                                            </span>
                                        </TableCell>
                                        <TableCell>
                                            <Link
                                                href={href(`/companies/${p.companyId}`)}
                                                className="text-ink hover:underline"
                                            >
                                                {p.companyName}
                                            </Link>
                                            {p.blockedReason && (
                                                <span className="text-ink-3 block text-xs">
                                                    {p.blockedReason}
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
                                            {p.sourceUrl ? (
                                                <a
                                                    href={p.sourceUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="hover:text-brand-ink hover:underline"
                                                >
                                                    {p.source}
                                                </a>
                                            ) : (
                                                p.source
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
                    Add to outreach
                </Button>
            </BulkBar>
        </div>
    );
}
