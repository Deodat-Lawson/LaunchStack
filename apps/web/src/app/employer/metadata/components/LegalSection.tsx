"use client";

import React from "react";
import { Scale, Calendar, Users as UsersIcon } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "~/app/employer/documents/components/ui/card";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { VisibilityBadge } from "./VisibilityBadge";
import { PriorityBadge } from "./PriorityBadge";
import type { LegalEntry } from "~/lib/tools/company-metadata/types";

interface LegalSectionProps {
    legal: LegalEntry[];
}

export function LegalSection({ legal }: LegalSectionProps) {
    return (
        <Card className="border-none shadow-sm">
            <CardHeader className="border-b border-border pb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-rose-600 rounded-lg">
                        <Scale className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <CardTitle className="text-lg font-bold">Legal Documents</CardTitle>
                        <p className="text-sm text-muted-foreground">
                            {legal.length} {legal.length === 1 ? "document" : "documents"} identified
                        </p>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="pt-6">
                <div className="space-y-4">
                    {legal.map((entry, index) => (
                        <LegalCard key={index} entry={entry} />
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}

function LegalCard({ entry }: { entry: LegalEntry }) {
    const typeValue = entry.type ? String(entry.type.value) : null;
    const statusValue = entry.status ? String(entry.status.value).toLowerCase() : null;

    const statusColor = statusValue === "active"
        ? "text-green-600 bg-green-100 dark:bg-green-900/30"
        : statusValue === "expired"
            ? "text-red-600 bg-red-100 dark:bg-red-900/30"
            : "text-amber-600 bg-amber-100 dark:bg-amber-900/30";

    return (
        <div className="p-4 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-2">
                    <h4 className="font-semibold text-foreground">
                        {String(entry.name.value)}
                    </h4>
                    {typeValue && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">
                            {typeValue.replace(/_/g, " ")}
                        </span>
                    )}
                    {statusValue && (
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusColor}`}>
                            {statusValue.charAt(0).toUpperCase() + statusValue.slice(1)}
                        </span>
                    )}
                    <VisibilityBadge visibility={entry.name.visibility} />
                    <PriorityBadge priority={entry.name.priority} />
                </div>

                {entry.summary && (
                    <p className="text-sm text-muted-foreground leading-relaxed mb-2">
                        {String(entry.summary.value)}
                    </p>
                )}

                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                    {entry.effective_date && (
                        <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            Effective: {String(entry.effective_date.value)}
                        </span>
                    )}
                    {entry.expiry_date && (
                        <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            Expires: {String(entry.expiry_date.value)}
                        </span>
                    )}
                    {entry.parties && (
                        <span className="flex items-center gap-1">
                            <UsersIcon className="w-3 h-3" />
                            {String(entry.parties.value)}
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-2 mt-3">
                    <ConfidenceBadge confidence={entry.name.confidence} />
                    {entry.name.sources.length > 0 && (
                        <span className="text-[10px] text-muted-foreground">
                            from {entry.name.sources[0]?.doc_name ?? "document"}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}
