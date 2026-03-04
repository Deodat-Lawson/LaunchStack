"use client";

import React from "react";
import {
    Building2,
    Globe,
    MapPin,
    Calendar,
    Users,
    Briefcase,
    ExternalLink,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "~/app/employer/documents/components/ui/card";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { VisibilityBadge } from "./VisibilityBadge";
import type { CompanyInfo, MetadataFact } from "~/lib/tools/company-metadata/types";

type AnyMetadataFact = MetadataFact<string> | MetadataFact<number> | MetadataFact<unknown>;

interface CompanyInfoCardProps {
    company: CompanyInfo;
}

interface FieldDisplayProps {
    label: string;
    fact: AnyMetadataFact | undefined;
    icon: React.ComponentType<{ className?: string }>;
    isLink?: boolean;
}

function FieldDisplay({ label, fact, icon: Icon, isLink }: FieldDisplayProps) {
    if (!fact) return null;

    const value = String(fact.value);

    return (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
            <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg shrink-0">
                <Icon className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        {label}
                    </span>
                    <VisibilityBadge visibility={fact.visibility} />
                    <ConfidenceBadge confidence={fact.confidence} />
                </div>
                {isLink && value.startsWith("http") ? (
                    <a
                        href={value}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-foreground font-medium hover:text-purple-600 transition-colors flex items-center gap-1 group"
                    >
                        <span className="truncate">{value}</span>
                        <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </a>
                ) : (
                    <p className="text-foreground font-medium">{value}</p>
                )}
                {fact.sources.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                        Source: {fact.sources[0]?.doc_name ?? "Unknown"}
                        {fact.sources.length > 1 && ` +${fact.sources.length - 1} more`}
                    </p>
                )}
            </div>
        </div>
    );
}

export function CompanyInfoCard({ company }: CompanyInfoCardProps) {
    return (
        <Card className="border-none shadow-sm">
            <CardHeader className="border-b border-border pb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-600 rounded-lg">
                        <Building2 className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <CardTitle className="text-lg font-bold">AI-Extracted Company Info</CardTitle>
                        <p className="text-sm text-muted-foreground">
                            Facts discovered by AI from your uploaded documents
                        </p>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="pt-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldDisplay
                        label="Company Name"
                        fact={company.name}
                        icon={Building2}
                    />
                    <FieldDisplay
                        label="Industry"
                        fact={company.industry}
                        icon={Briefcase}
                    />
                    <FieldDisplay
                        label="Headquarters"
                        fact={company.headquarters}
                        icon={MapPin}
                    />
                    <FieldDisplay
                        label="Founded"
                        fact={company.founded_year}
                        icon={Calendar}
                    />
                    <FieldDisplay
                        label="Company Size"
                        fact={company.size}
                        icon={Users}
                    />
                    <FieldDisplay
                        label="Website"
                        fact={company.website}
                        icon={Globe}
                        isLink
                    />
                </div>

                {company.description && (
                    <div className="mt-6 p-4 rounded-lg bg-muted/50">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                Description
                            </span>
                            <VisibilityBadge visibility={company.description.visibility} />
                            <ConfidenceBadge confidence={company.description.confidence} />
                        </div>
                        <p className="text-foreground leading-relaxed">
                            {String(company.description.value)}
                        </p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
