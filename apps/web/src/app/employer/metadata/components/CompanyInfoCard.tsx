"use client";

import React, { useState, useEffect } from "react";
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
import { PriorityBadge } from "./PriorityBadge";
import type { CompanyInfo, MetadataFact } from "@launchstack/features/company-metadata";

type AnyMetadataFact = MetadataFact<string> | MetadataFact<number> | MetadataFact<unknown>;

interface CompanyInfoCardProps {
    company: CompanyInfo;
    isEditMode?: boolean;
    onFieldSave?: (field: string, value: string) => Promise<void>;
}

interface FieldDisplayProps {
    label: string;
    fact: AnyMetadataFact | undefined;
    icon: React.ComponentType<{ className?: string }>;
    isLink?: boolean;
    fieldKey: string;
    isEditMode?: boolean;
    onFieldSave?: (field: string, value: string) => Promise<void>;
}

/** Inline editor strip: input + Save/Reset buttons. Used inside both FieldDisplay and the description section. */
function InlineEditor({
    fieldKey,
    initialValue,
    multiline,
    onFieldSave,
    onReset,
}: {
    fieldKey: string;
    initialValue: string;
    multiline?: boolean;
    onFieldSave: (field: string, value: string) => Promise<void>;
    onReset: () => void;
}) {
    const [value, setValue] = useState(initialValue);
    const [saving, setSaving] = useState(false);
    const [localError, setLocalError] = useState<string | null>(null);

    // Keep value in sync if parent resets (isEditMode toggled off → on)
    useEffect(() => {
        setValue(initialValue);
        setLocalError(null);
    }, [initialValue]);

    const handleSave = async () => {
        if (value.trim() === initialValue) return;
        setSaving(true);
        setLocalError(null);
        try {
            await onFieldSave(fieldKey, value.trim());
        } catch {
            setLocalError("Failed to save. Try again.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-2">
            {multiline ? (
                <textarea
                    className="w-full px-2 py-1 text-sm border border-border rounded bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                    rows={3}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    disabled={saving}
                />
            ) : (
                <input
                    className="w-full px-2 py-1 text-sm border border-border rounded bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-purple-500"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    disabled={saving}
                />
            )}
            {localError && <p className="text-xs text-destructive">{localError}</p>}
            <div className="flex gap-2">
                <button
                    onClick={() => void handleSave()}
                    disabled={saving || value.trim() === initialValue}
                    className="px-2 py-1 text-xs font-semibold bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 transition-colors"
                >
                    {saving ? "Saving..." : "Save"}
                </button>
                <button
                    onClick={() => { setValue(initialValue); setLocalError(null); onReset(); }}
                    disabled={saving}
                    className="px-2 py-1 text-xs font-semibold border border-border rounded hover:bg-muted transition-colors"
                >
                    Reset
                </button>
            </div>
        </div>
    );
}

function FieldDisplay({ label, fact, icon: Icon, isLink, fieldKey, isEditMode, onFieldSave }: FieldDisplayProps) {
    const [editKey, setEditKey] = useState(0); // bump to reset InlineEditor
    const currentValue = fact ? String(fact.value) : "";

    // When edit mode is toggled off, bump key so InlineEditor resets on next open
    useEffect(() => {
        if (!isEditMode) setEditKey((k) => k + 1);
    }, [isEditMode]);

    if (!fact && !isEditMode) return null;

    return (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
            <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg shrink-0">
                <Icon className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        {label}
                    </span>
                    {fact && <VisibilityBadge visibility={fact.visibility} />}
                    {fact && <ConfidenceBadge confidence={fact.confidence} />}
                    {fact && <PriorityBadge priority={fact.priority} />}
                </div>
                {isEditMode && onFieldSave ? (
                    <InlineEditor
                        key={editKey}
                        fieldKey={fieldKey}
                        initialValue={currentValue}
                        onFieldSave={onFieldSave}
                        onReset={() => undefined}
                    />
                ) : fact ? (
                    <>
                        {isLink && currentValue.startsWith("http") ? (
                            <a
                                href={currentValue}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-foreground font-medium hover:text-purple-600 transition-colors flex items-center gap-1 group"
                            >
                                <span className="truncate">{currentValue}</span>
                                <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                            </a>
                        ) : (
                            <p className="text-foreground font-medium">{currentValue}</p>
                        )}
                        {fact.priority === "manual_override" ? (
                            <p className="text-xs text-violet-600 dark:text-violet-400 font-semibold mt-1">
                                Manual edit
                            </p>
                        ) : (fact.sources?.length ?? 0) > 0 ? (
                            <p className="text-xs text-muted-foreground mt-1">
                                Source: {fact.sources[0]?.doc_name ?? "Unknown"}
                                {fact.sources.length > 1 && ` +${fact.sources.length - 1} more`}
                            </p>
                        ) : null}
                    </>
                ) : null}
            </div>
        </div>
    );
}

export function CompanyInfoCard({ company, isEditMode, onFieldSave }: CompanyInfoCardProps) {
    const [descEditKey, setDescEditKey] = useState(0);

    useEffect(() => {
        if (!isEditMode) setDescEditKey((k) => k + 1);
    }, [isEditMode]);

    const descValue = company.description ? String(company.description.value) : "";

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
                        fieldKey="company.name"
                        isEditMode={isEditMode}
                        onFieldSave={onFieldSave}
                    />
                    <FieldDisplay
                        label="Industry"
                        fact={company.industry}
                        icon={Briefcase}
                        fieldKey="company.industry"
                        isEditMode={isEditMode}
                        onFieldSave={onFieldSave}
                    />
                    <FieldDisplay
                        label="Headquarters"
                        fact={company.headquarters}
                        icon={MapPin}
                        fieldKey="company.headquarters"
                        isEditMode={isEditMode}
                        onFieldSave={onFieldSave}
                    />
                    <FieldDisplay
                        label="Founded"
                        fact={company.founded_year}
                        icon={Calendar}
                        fieldKey="company.founded_year"
                        isEditMode={isEditMode}
                        onFieldSave={onFieldSave}
                    />
                    <FieldDisplay
                        label="Company Size"
                        fact={company.size}
                        icon={Users}
                        fieldKey="company.size"
                        isEditMode={isEditMode}
                        onFieldSave={onFieldSave}
                    />
                    <FieldDisplay
                        label="Website"
                        fact={company.website}
                        icon={Globe}
                        isLink
                        fieldKey="company.website"
                        isEditMode={isEditMode}
                        onFieldSave={onFieldSave}
                    />
                </div>

                {(company.description ?? isEditMode) && (
                    <div className="mt-6 p-4 rounded-lg bg-muted/50">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                Description
                            </span>
                            {company.description && (
                                <>
                                    <VisibilityBadge visibility={company.description.visibility} />
                                    <ConfidenceBadge confidence={company.description.confidence} />
                                    <PriorityBadge priority={company.description.priority} />
                                </>
                            )}
                        </div>
                        {isEditMode && onFieldSave ? (
                            <InlineEditor
                                key={descEditKey}
                                fieldKey="company.description"
                                initialValue={descValue}
                                multiline
                                onFieldSave={onFieldSave}
                                onReset={() => undefined}
                            />
                        ) : (
                            company.description && (
                                <p className="text-foreground leading-relaxed">
                                    {descValue}
                                </p>
                            )
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
