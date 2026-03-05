"use client";

import React from "react";
import { Globe, Target, MapPin } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "~/app/employer/documents/components/ui/card";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { VisibilityBadge } from "./VisibilityBadge";
import type { MarketsInfo, MetadataFact } from "~/lib/tools/company-metadata/types";

interface MarketsSectionProps {
    markets: MarketsInfo;
}

export function MarketsSection({ markets }: MarketsSectionProps) {
    const hasPrimary = markets.primary && markets.primary.length > 0;
    const hasVerticals = markets.verticals && markets.verticals.length > 0;
    const hasGeographies = markets.geographies && markets.geographies.length > 0;

    return (
        <Card className="border-none shadow-sm">
            <CardHeader className="border-b border-border pb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-600 rounded-lg">
                        <Globe className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <CardTitle className="text-lg font-bold">Markets</CardTitle>
                        <p className="text-sm text-muted-foreground">
                            Target markets and geographic presence
                        </p>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="pt-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {hasPrimary && (
                        <MarketGroup
                            title="Primary Markets"
                            icon={Target}
                            items={markets.primary!}
                            color="purple"
                        />
                    )}
                    {hasVerticals && (
                        <MarketGroup
                            title="Verticals"
                            icon={Target}
                            items={markets.verticals!}
                            color="blue"
                        />
                    )}
                    {hasGeographies && (
                        <MarketGroup
                            title="Geographies"
                            icon={MapPin}
                            items={markets.geographies!}
                            color="green"
                        />
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

interface MarketGroupProps {
    title: string;
    icon: React.ComponentType<{ className?: string }>;
    items: MetadataFact[];
    color: "purple" | "blue" | "green";
}

const colorClasses = {
    purple: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    green: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
};

function MarketGroup({ title, icon: Icon, items, color }: MarketGroupProps) {
    return (
        <div>
            <div className="flex items-center gap-2 mb-3">
                <Icon className={`w-4 h-4 ${color === "purple" ? "text-purple-600" : color === "blue" ? "text-blue-600" : "text-green-600"}`} />
                <h4 className="text-sm font-semibold text-foreground">{title}</h4>
            </div>
            <div className="flex flex-wrap gap-2">
                {items.map((item, index) => (
                    <div
                        key={index}
                        className={`group relative px-3 py-1.5 rounded-lg text-sm font-medium ${colorClasses[color]} cursor-default`}
                    >
                        {String(item.value)}

                        {/* Hover tooltip */}
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-popover border border-border rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 min-w-[150px]">
                            <div className="flex items-center gap-2 mb-1">
                                <VisibilityBadge visibility={item.visibility} />
                                <ConfidenceBadge confidence={item.confidence} />
                            </div>
                            {item.sources.length > 0 && (
                                <p className="text-[10px] text-muted-foreground">
                                    Source: {item.sources[0]?.doc_name ?? "Unknown"}
                                </p>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
