"use client";

import React, { useState, useEffect } from "react";
import { Briefcase, CheckCircle, Clock, XCircle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "~/app/employer/documents/components/ui/card";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { VisibilityBadge } from "./VisibilityBadge";
import { PriorityBadge } from "./PriorityBadge";
import type { ServiceEntry, MetadataFact } from "~/lib/tools/company-metadata/types";

interface ServicesSectionProps {
    services: ServiceEntry[];
    isEditMode?: boolean;
    onFieldSave?: (path: string, value: string) => Promise<void>;
}

export function ServicesSection({ services, isEditMode, onFieldSave }: ServicesSectionProps) {
    return (
        <Card className="border-none shadow-sm">
            <CardHeader className="border-b border-border pb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-green-600 rounded-lg">
                        <Briefcase className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <CardTitle className="text-lg font-bold">Services & Products</CardTitle>
                        <p className="text-sm text-muted-foreground">
                            {services.length} {services.length === 1 ? "service" : "services"} identified
                        </p>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="pt-6">
                <div className="space-y-4">
                    {services.map((service, index) => (
                        <ServiceCard
                            key={index}
                            service={service}
                            index={index}
                            isEditMode={isEditMode}
                            onFieldSave={onFieldSave}
                        />
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}

function ServiceFieldEditor({
    path,
    initialValue,
    multiline,
    onSave,
}: {
    path: string;
    initialValue: string;
    multiline?: boolean;
    onSave: (path: string, value: string) => Promise<void>;
}) {
    const [value, setValue] = useState(initialValue);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setValue(initialValue);
        setError(null);
    }, [initialValue]);

    const handleSave = async () => {
        if (value.trim() === initialValue) return;
        setSaving(true);
        setError(null);
        try {
            await onSave(path, value.trim());
        } catch {
            setError("Failed to save.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-1">
            {multiline ? (
                <textarea
                    className="w-full px-2 py-1 text-sm border border-border rounded bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                    rows={2}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    disabled={saving}
                />
            ) : (
                <input
                    className="w-full px-2 py-1 text-sm border border-border rounded bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-green-500"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    disabled={saving}
                />
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex gap-2">
                <button
                    onClick={() => void handleSave()}
                    disabled={saving || value.trim() === initialValue}
                    className="px-2 py-0.5 text-xs font-semibold bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                    {saving ? "Saving..." : "Save"}
                </button>
                <button
                    onClick={() => { setValue(initialValue); setError(null); }}
                    disabled={saving}
                    className="px-2 py-0.5 text-xs font-semibold border border-border rounded hover:bg-muted transition-colors"
                >
                    Reset
                </button>
            </div>
        </div>
    );
}

/** Check all fields on a service for the best source to display */
function getServiceSource(service: ServiceEntry): { docName: string; hasManualEdit: boolean } {
    const allFacts: (MetadataFact<unknown> | undefined)[] = [
        service.name, service.description, service.status,
    ];
    const hasManualEdit = allFacts.some((f) => f?.priority === "manual_override");
    if (hasManualEdit) {
        return { docName: "Manual edit", hasManualEdit: true };
    }
    const firstSource = service.name.sources[0]?.doc_name ?? "document";
    return { docName: firstSource, hasManualEdit: false };
}

function ServiceCard({
    service,
    index,
    isEditMode,
    onFieldSave,
}: {
    service: ServiceEntry;
    index: number;
    isEditMode?: boolean;
    onFieldSave?: (path: string, value: string) => Promise<void>;
}) {
    const status = service.status ? String(service.status.value).toLowerCase() : "active";

    const StatusIcon = status === "active"
        ? CheckCircle
        : status === "deprecated"
            ? XCircle
            : Clock;

    const statusColor = status === "active"
        ? "text-green-600 bg-green-100 dark:bg-green-900/30"
        : status === "deprecated"
            ? "text-red-600 bg-red-100 dark:bg-red-900/30"
            : "text-amber-600 bg-amber-100 dark:bg-amber-900/30";

    if (isEditMode && onFieldSave) {
        return (
            <div className="p-4 rounded-lg bg-muted/50 space-y-3">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusColor}`}>
                        <StatusIcon className="w-3 h-3" />
                        {status.charAt(0).toUpperCase() + status.slice(1)}
                    </span>
                    <PriorityBadge priority={service.name.priority} />
                </div>
                <div>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Name</span>
                    <ServiceFieldEditor
                        path={`services.${index}.name`}
                        initialValue={String(service.name.value)}
                        onSave={onFieldSave}
                    />
                </div>
                <div>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Description</span>
                    <ServiceFieldEditor
                        path={`services.${index}.description`}
                        initialValue={service.description ? String(service.description.value) : ""}
                        multiline
                        onSave={onFieldSave}
                    />
                </div>
                <div>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</span>
                    <ServiceFieldEditor
                        path={`services.${index}.status`}
                        initialValue={service.status ? String(service.status.value) : "active"}
                        onSave={onFieldSave}
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="p-4 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
            <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                        <h4 className="font-semibold text-foreground">
                            {String(service.name.value)}
                        </h4>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusColor}`}>
                            <StatusIcon className="w-3 h-3" />
                            {status.charAt(0).toUpperCase() + status.slice(1)}
                        </span>
                        <VisibilityBadge visibility={service.name.visibility} />
                        <PriorityBadge priority={service.name.priority} />
                    </div>

                    {service.description && (
                        <p className="text-sm text-muted-foreground leading-relaxed">
                            {String(service.description.value)}
                        </p>
                    )}

                    <div className="flex items-center gap-2 mt-3">
                        <ConfidenceBadge confidence={service.name.confidence} />
                        {(() => {
                            const { docName, hasManualEdit } = getServiceSource(service);
                            return hasManualEdit ? (
                                <span className="text-[10px] text-violet-600 dark:text-violet-400 font-semibold">
                                    Manual edit
                                </span>
                            ) : (
                                <span className="text-[10px] text-muted-foreground">
                                    from {docName}
                                </span>
                            );
                        })()}
                    </div>
                </div>
            </div>
        </div>
    );
}
