"use client";

import React from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge } from "~/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "~/components/ui/table";
import { isBuiltinRole, normalizeRoleSlug, roleLabel } from "~/lib/authz/permissions";
import { cn } from "~/lib/utils";
import type { EmployeeInfo } from "../types";

interface EmployeeActivityTableProps {
    employees: EmployeeInfo[];
}

type TimeT = ReturnType<typeof useTranslations<"statistics.time">>;

/** "Just now", "5 min ago", "3 hr ago", "2 days ago"; a date after a week. */
function formatRelativeTime(
    dateString: string | null,
    t: TimeT,
    format: ReturnType<typeof useFormatter>
): string {
    if (!dateString) return t("never");

    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return t("justNow");
    if (diffMins < 60) return t("minutesAgo", { count: diffMins });
    if (diffHours < 24) return t("hoursAgo", { count: diffHours });
    if (diffDays < 7) return t("daysAgo", { count: diffDays });
    return format.dateTime(date, { year: "numeric", month: "numeric", day: "numeric" });
}

/** The dashboard reports the membership role slug; built-ins get a tint, custom roles stay neutral. */
function roleVariant(role: string): "default" | "info" | "secondary" {
    const slug = normalizeRoleSlug(role);
    if (slug === "owner") return "default";
    if (slug === "admin") return "info";
    return "secondary";
}

function statusVariant(status: string): "success" | "warn" | "secondary" {
    if (status === "active") return "success";
    if (status === "pending") return "warn";
    return "secondary";
}

type MembersT = ReturnType<typeof useTranslations<"statistics.members">>;

function statusLabel(status: string, t: MembersT): string {
    if (status === "active") return t("statuses.active");
    if (status === "pending") return t("statuses.pending");
    if (status === "suspended") return t("statuses.suspended");
    return status;
}

/** Built-in roles in the interface language; a custom role keeps its own name. */
function memberRoleLabel(role: string, t: MembersT): string {
    const slug = normalizeRoleSlug(role);
    return isBuiltinRole(slug) ? t(`roles.${slug}`) : roleLabel(role);
}

const HEAD = "text-ink-3 h-9 text-xs font-medium";

/** The table sits flush in its section's card; the section heading names it. */
export function EmployeeActivityTable({ employees }: EmployeeActivityTableProps) {
    const t = useTranslations("statistics.members");
    const tTime = useTranslations("statistics.time");
    const format = useFormatter();
    return (
        <>
            <div className="border-line flex items-center border-b px-4 py-3">
                <p className="text-ink-3 m-0 text-[13px] tabular-nums">
                    {t("total", { count: employees.length })}
                </p>
            </div>

            <Table aria-label={t("title")}>
                <TableHeader className="bg-panel-2">
                    <TableRow className="border-line hover:bg-transparent">
                        <TableHead className={cn(HEAD, "pl-4")}>{t("columns.name")}</TableHead>
                        <TableHead className={HEAD}>{t("columns.role")}</TableHead>
                        <TableHead className={HEAD}>{t("columns.status")}</TableHead>
                        <TableHead className={cn(HEAD, "text-right")}>
                            {t("columns.queries")}
                        </TableHead>
                        <TableHead className={cn(HEAD, "pr-4 text-right")}>
                            {t("columns.lastOnline")}
                        </TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {employees.length === 0 && (
                        <TableRow className="hover:bg-transparent">
                            <TableCell colSpan={5} className="text-ink-3 py-8 text-center text-sm">
                                {t("empty")}
                            </TableCell>
                        </TableRow>
                    )}
                    {employees.map(employee => (
                        <TableRow key={employee.id} className="border-line-2 hover:bg-panel-2/60">
                            <TableCell className="py-2.5 pl-4">
                                <div className="flex flex-col">
                                    <span className="text-ink text-sm font-medium">
                                        {employee.name}
                                    </span>
                                    <span className="text-ink-3 text-xs">{employee.email}</span>
                                </div>
                            </TableCell>
                            <TableCell className="py-2.5">
                                <Badge variant={roleVariant(employee.role)}>
                                    {memberRoleLabel(employee.role, t)}
                                </Badge>
                            </TableCell>
                            <TableCell className="py-2.5">
                                <Badge variant={statusVariant(employee.status)}>
                                    {statusLabel(employee.status, t)}
                                </Badge>
                            </TableCell>
                            <TableCell className="text-ink py-2.5 text-right text-sm tabular-nums">
                                {format.number(employee.queryCount)}
                            </TableCell>
                            <TableCell className="text-ink-3 py-2.5 pr-4 text-right text-sm">
                                {formatRelativeTime(employee.lastActiveAt, tTime, format)}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </>
    );
}
