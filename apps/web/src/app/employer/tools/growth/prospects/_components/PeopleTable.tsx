"use client";

import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { Checkbox } from "~/components/ui/checkbox";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "~/components/ui/table";

import type { PersonRow } from "../api";
import { EmailStatus, canOutreach } from "./EmailStatus";

export function PeopleTable({
    rows,
    selected,
    onToggle,
    onToggleAll,
    onOpenCompany,
}: {
    rows: PersonRow[];
    selected: Set<string>;
    onToggle: (id: string) => void;
    onToggleAll: (checked: boolean) => void;
    onOpenCompany: (companyId: string) => void;
}) {
    const eligible = rows.filter(p => canOutreach(p.emailStatus) && !p.blockedReason);
    return (
        <div className="border-line bg-panel overflow-x-auto rounded-lg border">
            <Table className="text-[13px]">
                <TableHeader>
                    <TableRow className="hover:bg-transparent">
                        <TableHead className="w-9 pl-3">
                            <Checkbox
                                aria-label="Select all eligible"
                                checked={
                                    eligible.length > 0 && eligible.every(p => selected.has(p.id))
                                }
                                onCheckedChange={checked => onToggleAll(checked === true)}
                            />
                        </TableHead>
                        <TableHead className="text-ink-3 text-xs font-medium">Person</TableHead>
                        <TableHead className="text-ink-3 text-xs font-medium">Company</TableHead>
                        <TableHead className="text-ink-3 text-xs font-medium">Email</TableHead>
                        <TableHead className="text-ink-3 text-xs font-medium">Source</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.map(p => {
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
                                        onCheckedChange={() => onToggle(p.id)}
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
                                                {p.title}
                                                {p.seniority !== "—" ? ` · ${p.seniority}` : ""}
                                            </span>
                                        </span>
                                    </span>
                                </TableCell>
                                <TableCell>
                                    <button
                                        type="button"
                                        onClick={() => onOpenCompany(p.companyId)}
                                        className="text-ink focus-visible:ring-brand/50 rounded-sm text-left outline-none hover:underline focus-visible:ring-2"
                                    >
                                        {p.companyName}
                                    </button>
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
    );
}
