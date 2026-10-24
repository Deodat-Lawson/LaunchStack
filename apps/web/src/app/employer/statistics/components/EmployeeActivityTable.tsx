"use client";

import React from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Clock, MessageSquare, Users } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Card } from "~/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "~/components/ui/table";
import { isBuiltinRole, normalizeRoleSlug, roleLabel } from "~/lib/authz/permissions";
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

export function EmployeeActivityTable({ employees }: EmployeeActivityTableProps) {
    const t = useTranslations("statistics.members");
    const tTime = useTranslations("statistics.time");
    const format = useFormatter();
    return (
        <Card className="border-none p-6 shadow-sm">
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="bg-success-soft text-success rounded-lg p-1.5">
                        <Users className="h-4 w-4" />
                    </div>
                    <h2 className="text-ink text-sm font-bold uppercase tracking-widest">
                        {t("title")}
                    </h2>
                </div>
                <Badge variant="success" className="rounded-full px-3 py-1 font-bold">
                    {t("total", { count: employees.length })}
                </Badge>
            </div>

            <div className="border-line overflow-hidden rounded-lg border">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-panel-2/50">
                            <TableHead className="text-[10px] font-bold uppercase tracking-widest">
                                {t("columns.name")}
                            </TableHead>
                            <TableHead className="text-[10px] font-bold uppercase tracking-widest">
                                {t("columns.role")}
                            </TableHead>
                            <TableHead className="text-[10px] font-bold uppercase tracking-widest">
                                {t("columns.status")}
                            </TableHead>
                            <TableHead className="text-[10px] font-bold uppercase tracking-widest">
                                {t("columns.queries")}
                            </TableHead>
                            <TableHead className="text-right text-[10px] font-bold uppercase tracking-widest">
                                {t("columns.lastOnline")}
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {employees.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={5} className="text-ink-3 py-8 text-center">
                                    {t("empty")}
                                </TableCell>
                            </TableRow>
                        )}
                        {employees.map(employee => (
                            <TableRow key={employee.id} className="hover:bg-panel-2/30">
                                <TableCell className="font-medium">
                                    <div className="flex flex-col">
                                        <span>{employee.name}</span>
                                        <span className="text-ink-3 text-xs">{employee.email}</span>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <Badge
                                        variant={roleVariant(employee.role)}
                                        className="text-[10px] font-bold uppercase"
                                    >
                                        {memberRoleLabel(employee.role, t)}
                                    </Badge>
                                </TableCell>
                                <TableCell>
                                    <Badge
                                        variant={statusVariant(employee.status)}
                                        className="text-[10px] font-bold uppercase"
                                    >
                                        {statusLabel(employee.status, t)}
                                    </Badge>
                                </TableCell>
                                <TableCell>
                                    <div className="flex items-center gap-2">
                                        <MessageSquare className="text-ink-3 h-3 w-3" />
                                        <span className="font-mono">
                                            {format.number(employee.queryCount)}
                                        </span>
                                    </div>
                                </TableCell>
                                <TableCell className="text-ink-3 text-right text-sm">
                                    <div className="flex items-center justify-end gap-2">
                                        <Clock className="h-3 w-3" />
                                        {formatRelativeTime(employee.lastActiveAt, tTime, format)}
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </Card>
    );
}
