"use client";

import React from "react";
import { FileText, Clock, Cpu, Hash } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "~/app/employer/documents/components/ui/card";
import type { ProvenanceInfo } from "~/lib/tools/company-metadata/types";

interface ProvenanceCardProps {
    provenance: ProvenanceInfo;
    updatedAt?: string;
}

export function ProvenanceCard({ provenance, updatedAt }: ProvenanceCardProps) {
    const formatDate = (dateStr: string | undefined) => {
        if (!dateStr) return "Unknown";
        try {
            return new Date(dateStr).toLocaleString();
        } catch {
            return dateStr;
        }
    };

    return (
        <Card className="border-none shadow-sm bg-muted/30">
            <CardHeader className="border-b border-border pb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-gray-600 rounded-lg">
                        <Cpu className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <CardTitle className="text-lg font-bold">Extraction Details</CardTitle>
                        <p className="text-sm text-muted-foreground">
                            Information about how this metadata was extracted
                        </p>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="pt-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <ProvenanceItem
                        icon={FileText}
                        label="Documents Processed"
                        value={provenance.total_documents_processed.toString()}
                    />
                    <ProvenanceItem
                        icon={Hash}
                        label="Extraction Version"
                        value={provenance.extraction_version || "1.0.0"}
                    />
                    <ProvenanceItem
                        icon={Clock}
                        label="Last Updated"
                        value={formatDate(updatedAt)}
                    />
                    {provenance.last_document_processed && (
                        <ProvenanceItem
                            icon={FileText}
                            label="Last Document"
                            value={provenance.last_document_processed.doc_name}
                        />
                    )}
                </div>

                {provenance.extraction_model && (
                    <div className="mt-4 p-3 rounded-lg bg-muted/50">
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            Extraction Model
                        </span>
                        <p className="text-sm text-foreground font-mono mt-1">
                            {provenance.extraction_model}
                        </p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

interface ProvenanceItemProps {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    value: string;
}

function ProvenanceItem({ icon: Icon, label, value }: ProvenanceItemProps) {
    return (
        <div className="flex items-start gap-3">
            <div className="p-2 bg-muted rounded-lg">
                <Icon className="w-4 h-4 text-muted-foreground" />
            </div>
            <div>
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block">
                    {label}
                </span>
                <p className="text-sm text-foreground font-medium mt-0.5 truncate max-w-[150px]" title={value}>
                    {value}
                </p>
            </div>
        </div>
    );
}
