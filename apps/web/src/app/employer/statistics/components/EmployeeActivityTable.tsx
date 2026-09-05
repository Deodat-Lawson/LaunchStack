"use client";

import React from "react";
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
import { normalizeRoleSlug, roleLabel } from "~/lib/authz/permissions";
import type { EmployeeInfo } from "../types";

interface EmployeeActivityTableProps {
    employees: EmployeeInfo[];
}

function formatRelativeTime(dateString: string | null): string {
    if (!dateString) return "Never";

    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hr ago`;
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
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

function statusLabel(status: string): string {
    if (status === "active") return "Active";
    if (status === "pending") return "Pending approval";
    if (status === "suspended") return "Suspended";
    return status;
}

export function EmployeeActivityTable({ employees }: EmployeeActivityTableProps) {
    return (
        <Card className="border-none p-6 shadow-sm">
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="bg-success-soft text-success rounded-lg p-1.5">
                        <Users className="h-4 w-4" />
                    </div>
                    <h2 className="text-ink text-sm font-bold uppercase tracking-widest">
                        Member activity
                    </h2>
                </div>
                <Badge variant="success" className="rounded-full px-3 py-1 font-bold">
                    {employees.length} total
                </Badge>
            </div>

            <div className="border-line overflow-hidden rounded-lg border">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-panel-2/50">
                            <TableHead className="text-[10px] font-bold uppercase tracking-widest">
                                Name
                            </TableHead>
                            <TableHead className="text-[10px] font-bold uppercase tracking-widest">
                                Role
                            </TableHead>
                            <TableHead className="text-[10px] font-bold uppercase tracking-widest">
                                Status
                            </TableHead>
                            <TableHead className="text-[10px] font-bold uppercase tracking-widest">
                                Queries made
                            </TableHead>
                            <TableHead className="text-right text-[10px] font-bold uppercase tracking-widest">
                                Last online
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {employees.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={5} className="text-ink-3 py-8 text-center">
                                    No members yet.
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
                                        {roleLabel(employee.role)}
                                    </Badge>
                                </TableCell>
                                <TableCell>
                                    <Badge
                                        variant={statusVariant(employee.status)}
                                        className="text-[10px] font-bold uppercase"
                                    >
                                        {statusLabel(employee.status)}
                                    </Badge>
                                </TableCell>
                                <TableCell>
                                    <div className="flex items-center gap-2">
                                        <MessageSquare className="text-ink-3 h-3 w-3" />
                                        <span className="font-mono">{employee.queryCount}</span>
                                    </div>
                                </TableCell>
                                <TableCell className="text-ink-3 text-right text-sm">
                                    <div className="flex items-center justify-end gap-2">
                                        <Clock className="h-3 w-3" />
                                        {formatRelativeTime(employee.lastActiveAt)}
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
