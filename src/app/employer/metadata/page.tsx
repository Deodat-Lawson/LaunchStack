"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
    Building2,
    Users,
    Briefcase,
    RefreshCw,
    AlertCircle,
    FileText,
    Sparkles,
} from "lucide-react";
import { Button } from "~/app/employer/documents/components/ui/button";
import { Card } from "~/app/employer/documents/components/ui/card";
import { cn } from "~/lib/utils";
import { EmployerNavbar } from "~/app/employer/_components/EmployerNavbar";
import { CompanyInfoCard } from "./components/CompanyInfoCard";
import { PeopleSection } from "./components/PeopleSection";
import { ServicesSection } from "./components/ServicesSection";
import { MarketsSection } from "./components/MarketsSection";
import { ProvenanceCard } from "./components/ProvenanceCard";
import type { CompanyMetadataJSON } from "~/lib/tools/company-metadata/types";

interface MetadataResponse {
    metadata: CompanyMetadataJSON | null;
    schemaVersion?: string;
    createdAt?: string;
    updatedAt?: string;
    message?: string;
    error?: string;
}

export default function MetadataPage() {
    const [data, setData] = useState<MetadataResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [extracting, setExtracting] = useState(false);

    const fetchMetadata = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const response = await fetch("/api/company/metadata");
            const result = (await response.json()) as MetadataResponse;

            if (result.error) {
                throw new Error(result.error);
            }

            setData(result);
        } catch (err) {
            setError(err instanceof Error ? err.message : "An error occurred");
        } finally {
            setLoading(false);
        }
    }, []);

    const runExtraction = useCallback(async () => {
        setExtracting(true);
        setError(null);

        try {
            const response = await fetch("/api/company/metadata/extract", {
                method: "POST",
            });
            const result = (await response.json()) as { error?: string };

            if (result.error) {
                throw new Error(result.error);
            }

            // Refresh metadata after extraction
            await fetchMetadata();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Extraction failed");
        } finally {
            setExtracting(false);
        }
    }, [fetchMetadata]);

    useEffect(() => {
        void fetchMetadata();
    }, [fetchMetadata]);

    if (loading && !data) {
        return (
            <div className="flex flex-col min-h-screen bg-background">
                <EmployerNavbar />
                <div className="flex flex-col items-center justify-center flex-1 py-20">
                    <div className="relative mb-8">
                        <div className="w-20 h-20 border-4 border-purple-100 dark:border-purple-900/30 rounded-full border-t-purple-600 dark:border-t-purple-500 animate-spin" />
                        <Building2 className="w-8 h-8 text-purple-600 dark:text-purple-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse" />
                    </div>
                    <h3 className="text-xl font-bold text-foreground mb-2">Loading Company Metadata</h3>
                    <p className="text-muted-foreground max-w-sm text-center font-medium">
                        Fetching extracted company information...
                    </p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col min-h-screen bg-background">
                <EmployerNavbar />
                <div className="flex flex-col items-center justify-center flex-1 py-20">
                    <Card className="p-6 border-destructive/20 bg-destructive/10 max-w-md">
                        <div className="flex items-start gap-4">
                            <div className="p-2 bg-destructive/20 rounded-lg">
                                <AlertCircle className="w-6 h-6 text-destructive" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-destructive">Failed to Load</h3>
                                <p className="text-destructive text-sm mt-1 font-medium">{error}</p>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void fetchMetadata()}
                                    className="mt-4 border-destructive/30 text-destructive hover:bg-destructive/10"
                                >
                                    Try Again
                                </Button>
                            </div>
                        </div>
                    </Card>
                </div>
            </div>
        );
    }

    const metadata = data?.metadata;
    const hasMetadata = metadata && Object.keys(metadata.company).length > 0;

    return (
        <div className="flex flex-col min-h-screen bg-background">
            <EmployerNavbar />

            {/* Header */}
            <div className="bg-background border-b border-border px-8 py-6 flex-shrink-0 z-10 shadow-sm sticky top-[73px]">
                <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-purple-600 rounded-2xl shadow-lg shadow-purple-500/20">
                            <Building2 className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-foreground leading-tight">
                                Company Metadata
                            </h1>
                            <p className="text-sm text-muted-foreground font-medium mt-1">
                                AI-extracted information from your uploaded documents
                            </p>
                        </div>
                    </div>

                    <div className="flex gap-3">
                        <Button
                            onClick={() => void runExtraction()}
                            disabled={extracting}
                            variant="outline"
                            className="rounded-xl h-11 px-6 gap-2 font-bold transition-all hover:scale-[1.02] active:scale-[0.98]"
                        >
                            <Sparkles className={cn("w-4 h-4", extracting && "animate-pulse")} />
                            {extracting ? "Extracting..." : "Re-extract"}
                        </Button>
                        <Button
                            onClick={() => void fetchMetadata()}
                            disabled={loading}
                            className="bg-purple-600 hover:bg-purple-700 text-white rounded-xl h-11 px-6 shadow-lg shadow-purple-500/20 gap-2 font-bold transition-all hover:scale-[1.02] active:scale-[0.98]"
                        >
                            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
                            {loading ? "Refreshing..." : "Refresh"}
                        </Button>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
                <div className="max-w-7xl mx-auto p-8 space-y-8">
                    {!hasMetadata ? (
                        /* Empty State */
                        <Card className="p-12 border-dashed border-2">
                            <div className="flex flex-col items-center text-center">
                                <div className="p-4 bg-purple-100 dark:bg-purple-900/30 rounded-full mb-6">
                                    <FileText className="w-12 h-12 text-purple-600 dark:text-purple-400" />
                                </div>
                                <h3 className="text-xl font-bold text-foreground mb-2">
                                    No Metadata Extracted Yet
                                </h3>
                                <p className="text-muted-foreground max-w-md mb-6">
                                    Upload documents and run the extraction process to automatically
                                    extract company information, people, services, and more.
                                </p>
                                <Button
                                    onClick={() => void runExtraction()}
                                    disabled={extracting}
                                    className="bg-purple-600 hover:bg-purple-700 text-white rounded-xl h-11 px-8 shadow-lg shadow-purple-500/20 gap-2 font-bold"
                                >
                                    <Sparkles className={cn("w-4 h-4", extracting && "animate-spin")} />
                                    {extracting ? "Extracting..." : "Extract Metadata Now"}
                                </Button>
                            </div>
                        </Card>
                    ) : (
                        <>
                            {/* Summary Stats */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                <StatsCard
                                    title="Company Fields"
                                    value={Object.keys(metadata.company).filter(k => metadata.company[k]).length}
                                    icon={Building2}
                                    color="purple"
                                />
                                <StatsCard
                                    title="People"
                                    value={metadata.people.length}
                                    icon={Users}
                                    color="blue"
                                />
                                <StatsCard
                                    title="Services"
                                    value={metadata.services.length}
                                    icon={Briefcase}
                                    color="green"
                                />
                                <StatsCard
                                    title="Documents Processed"
                                    value={metadata.provenance.total_documents_processed}
                                    icon={FileText}
                                    color="amber"
                                />
                            </div>

                            {/* Company Info */}
                            <CompanyInfoCard company={metadata.company} />

                            {/* People Section */}
                            {metadata.people.length > 0 && (
                                <PeopleSection people={metadata.people} />
                            )}

                            {/* Services Section */}
                            {metadata.services.length > 0 && (
                                <ServicesSection services={metadata.services} />
                            )}

                            {/* Markets Section */}
                            {(metadata.markets.primary?.length ?? 0) > 0 ||
                             (metadata.markets.geographies?.length ?? 0) > 0 ? (
                                <MarketsSection markets={metadata.markets} />
                            ) : null}

                            {/* Provenance */}
                            <ProvenanceCard
                                provenance={metadata.provenance}
                                updatedAt={data?.updatedAt}
                            />
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

/* Local StatsCard component */
interface StatsCardProps {
    title: string;
    value: number | string;
    icon: React.ComponentType<{ className?: string }>;
    color: "purple" | "blue" | "green" | "amber";
}

const colorMap = {
    purple: { border: "border-l-purple-500", text: "text-purple-500" },
    blue: { border: "border-l-blue-500", text: "text-blue-500" },
    green: { border: "border-l-green-500", text: "text-green-500" },
    amber: { border: "border-l-amber-500", text: "text-amber-500" },
};

function StatsCard({ title, value, icon: Icon, color }: StatsCardProps) {
    const colors = colorMap[color];
    return (
        <Card className={cn(
            "p-5 border-none shadow-sm bg-card flex flex-col justify-between group hover:shadow-md transition-all border-l-4",
            colors.border
        )}>
            <div className="flex justify-between items-start mb-2">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                    {title}
                </span>
                <Icon className={cn("w-4 h-4", colors.text)} />
            </div>
            <div className="text-3xl font-black text-foreground">{value}</div>
        </Card>
    );
}
