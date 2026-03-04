"use client";

import React from "react";
import { Briefcase, CheckCircle, Clock, XCircle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "~/app/employer/documents/components/ui/card";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { VisibilityBadge } from "./VisibilityBadge";
import type { ServiceEntry } from "~/lib/tools/company-metadata/types";

interface ServicesSectionProps {
    services: ServiceEntry[];
}

export function ServicesSection({ services }: ServicesSectionProps) {
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
                        <ServiceCard key={index} service={service} />
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}

function ServiceCard({ service }: { service: ServiceEntry }) {
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
                    </div>

                    {service.description && (
                        <p className="text-sm text-muted-foreground leading-relaxed">
                            {String(service.description.value)}
                        </p>
                    )}

                    <div className="flex items-center gap-2 mt-3">
                        <ConfidenceBadge confidence={service.name.confidence} />
                        {service.name.sources.length > 0 && (
                            <span className="text-[10px] text-muted-foreground">
                                from {service.name.sources[0]?.doc_name ?? "document"}
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
