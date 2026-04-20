"use client";

import React from "react";
import { Card } from "~/app/employer/documents/components/ui/card";
import { Badge } from "~/app/employer/documents/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "~/app/employer/documents/components/ui/table";
import { Users, Clock, MessageSquare } from "lucide-react";
import { cn } from "~/lib/utils";
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

export function EmployeeActivityTable({ employees }: EmployeeActivityTableProps) {
    return (
        <Card className="p-6 border-none shadow-sm">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="p-1.5 bg-green-100 dark:bg-green-900/30 rounded-lg text-green-600 dark:text-green-400">
                        <Users className="w-4 h-4" />
                    </div>
                    <h2 className="text-sm font-bold text-foreground uppercase tracking-widest">
                        Employee Activity
                    </h2>
                </div>
                <Badge
                    variant="outline"
                    className="rounded-full px-3 py-1 border-green-200 dark:border-green-900/30 text-green-600 dark:text-green-400 font-bold"
                >
                    {employees.length} Total
                </Badge>
            </div>

            <div className="rounded-lg border border-border overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-muted/50">
                            <TableHead className="font-bold text-[10px] uppercase tracking-widest">
                                Name
                            </TableHead>
                            <TableHead className="font-bold text-[10px] uppercase tracking-widest">
                                Role
                            </TableHead>
                            <TableHead className="font-bold text-[10px] uppercase tracking-widest">
                                Status
                            </TableHead>
                            <TableHead className="font-bold text-[10px] uppercase tracking-widest">
                                Queries Made
                            </TableHead>
                            <TableHead className="font-bold text-[10px] uppercase tracking-widest text-right">
                                Last Online
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {employees.map((employee) => (
                            <TableRow key={employee.id} className="hover:bg-muted/30">
                                <TableCell className="font-medium">
                                    <div className="flex flex-col">
                                        <span>{employee.name}</span>
                                        <span className="text-xs text-muted-foreground">{employee.email}</span>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <Badge
                                        variant="outline"
                                        className={cn(
                                            "text-[10px] font-bold uppercase",
                                            employee.role === "owner"
                                                ? "border-purple-200 text-purple-600 dark:border-purple-900/30 dark:text-purple-400"
                                                : employee.role === "employer"
                                                ? "border-blue-200 text-blue-600 dark:border-blue-900/30 dark:text-blue-400"
                                                : "border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-400"
                                        )}
                                    >
                                        {employee.role}
                                    </Badge>
                                </TableCell>
                                <TableCell>
                                    <Badge
                                        variant="outline"
                                        className={cn(
                                            "text-[10px] font-bold uppercase",
                                            employee.status === "verified"
                                                ? "border-green-200 text-green-600 dark:border-green-900/30 dark:text-green-400"
                                                : "border-amber-200 text-amber-600 dark:border-amber-900/30 dark:text-amber-400"
                                        )}
                                    >
                                        {employee.status}
                                    </Badge>
                                </TableCell>
                                <TableCell>
                                    <div className="flex items-center gap-2">
                                        <MessageSquare className="w-3 h-3 text-muted-foreground" />
                                        <span className="font-mono">{employee.queryCount}</span>
                                    </div>
                                </TableCell>
                                <TableCell className="text-muted-foreground text-sm text-right">
                                    <div className="flex items-center justify-end gap-2">
                                        <Clock className="w-3 h-3" />
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
