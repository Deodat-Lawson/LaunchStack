"use client";

import React, { useState, useEffect } from "react";
import { Globe, Target, MapPin } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "~/app/employer/documents/components/ui/card";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { VisibilityBadge } from "./VisibilityBadge";
import { PriorityBadge } from "./PriorityBadge";
import type { MarketsInfo, MetadataFact } from "~/lib/tools/company-metadata/types";

interface MarketsSectionProps {
    markets: MarketsInfo;
    isEditMode?: boolean;
    onFieldSave?: (path: string, value: string) => Promise<void>;
}

export function MarketsSection({ markets, isEditMode, onFieldSave }: MarketsSectionProps) {
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
                            subfield="primary"
                            icon={Target}
                            items={markets.primary!}
                            color="purple"
                            isEditMode={isEditMode}
                            onFieldSave={onFieldSave}
                        />
                    )}
                    {hasVerticals && (
                        <MarketGroup
                            title="Verticals"
                            subfield="verticals"
                            icon={Target}
                            items={markets.verticals!}
                            color="blue"
                            isEditMode={isEditMode}
                            onFieldSave={onFieldSave}
                        />
                    )}
                    {hasGeographies && (
                        <MarketGroup
                            title="Geographies"
                            subfield="geographies"
                            icon={MapPin}
                            items={markets.geographies!}
                            color="green"
                            isEditMode={isEditMode}
                            onFieldSave={onFieldSave}
                        />
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

interface MarketGroupProps {
    title: string;
    subfield: string;
    icon: React.ComponentType<{ className?: string }>;
    items: MetadataFact[];
    color: "purple" | "blue" | "green";
    isEditMode?: boolean;
    onFieldSave?: (path: string, value: string) => Promise<void>;
}

const colorClasses = {
    purple: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    green: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
};

const ringColors = {
    purple: "focus:ring-purple-500",
    blue: "focus:ring-blue-500",
    green: "focus:ring-green-500",
};

const btnColors = {
    purple: "bg-purple-600 hover:bg-purple-700",
    blue: "bg-blue-600 hover:bg-blue-700",
    green: "bg-green-600 hover:bg-green-700",
};

function MarketItemEditor({
    path,
    initialValue,
    color,
    onSave,
}: {
    path: string;
    initialValue: string;
    color: "purple" | "blue" | "green";
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
        <div className="flex items-center gap-2">
            <input
                className={`flex-1 px-2 py-1 text-sm border border-border rounded bg-background text-foreground focus:outline-none focus:ring-2 ${ringColors[color]}`}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                disabled={saving}
            />
            <button
                onClick={() => void handleSave()}
                disabled={saving || value.trim() === initialValue}
                className={`px-2 py-1 text-xs font-semibold text-white rounded disabled:opacity-50 transition-colors ${btnColors[color]}`}
            >
                {saving ? "..." : "Save"}
            </button>
            {error && <span className="text-xs text-destructive">{error}</span>}
        </div>
    );
}

function MarketGroup({ title, subfield, icon: Icon, items, color, isEditMode, onFieldSave }: MarketGroupProps) {
    return (
        <div>
            <div className="flex items-center gap-2 mb-3">
                <Icon className={`w-4 h-4 ${color === "purple" ? "text-purple-600" : color === "blue" ? "text-blue-600" : "text-green-600"}`} />
                <h4 className="text-sm font-semibold text-foreground">{title}</h4>
            </div>
            {isEditMode && onFieldSave ? (
                <div className="space-y-2">
                    {items.map((item, index) => (
                        <div key={index}>
                            <div className="flex items-center gap-1 mb-1">
                                <PriorityBadge priority={item.priority} />
                            </div>
                            <MarketItemEditor
                                path={`markets.${subfield}.${index}`}
                                initialValue={String(item.value)}
                                color={color}
                                onSave={onFieldSave}
                            />
                        </div>
                    ))}
                </div>
            ) : (
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
                                    <PriorityBadge priority={item.priority} />
                                </div>
                                {item.priority === "manual_override" ? (
                                    <p className="text-[10px] text-violet-600 dark:text-violet-400 font-semibold">
                                        Manual edit
                                    </p>
                                ) : item.sources.length > 0 ? (
                                    <p className="text-[10px] text-muted-foreground">
                                        Source: {item.sources[0]?.doc_name ?? "Unknown"}
                                    </p>
                                ) : null}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
