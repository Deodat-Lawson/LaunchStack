"use client";

import React, { useState, useEffect } from "react";
import { Users, Mail, Phone, Building } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "~/app/employer/documents/components/ui/card";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { VisibilityBadge } from "./VisibilityBadge";
import { PriorityBadge } from "./PriorityBadge";
import type { PersonEntry, MetadataFact } from "@launchstack/features/company-metadata";

interface PeopleSectionProps {
    people: PersonEntry[];
    isEditMode?: boolean;
    onFieldSave?: (path: string, value: string) => Promise<void>;
}

export function PeopleSection({ people, isEditMode, onFieldSave }: PeopleSectionProps) {
    return (
        <Card className="border-none shadow-sm">
            <CardHeader className="border-b border-border pb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-600 rounded-lg">
                        <Users className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <CardTitle className="text-lg font-bold">People</CardTitle>
                        <p className="text-sm text-muted-foreground">
                            {people.length} {people.length === 1 ? "person" : "people"} extracted from documents
                        </p>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="pt-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {people.map((person, index) => (
                        <PersonCard
                            key={index}
                            person={person}
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

function PersonFieldEditor({
    path,
    initialValue,
    onSave,
}: {
    path: string;
    initialValue: string;
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
        <div className="space-y-1 mt-1">
            <input
                className="w-full px-2 py-1 text-sm border border-border rounded bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                disabled={saving}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex gap-2">
                <button
                    onClick={() => void handleSave()}
                    disabled={saving || value.trim() === initialValue}
                    className="px-2 py-0.5 text-xs font-semibold bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
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

/** Check all fields on a person for the best source to display */
function getPersonSource(person: PersonEntry): { docName: string; hasManualEdit: boolean } {
    const allFacts: (MetadataFact<unknown> | undefined)[] = [
        person.name, person.role, person.email, person.phone, person.department,
    ];
    const hasManualEdit = allFacts.some((f) => f?.priority === "manual_override");
    if (hasManualEdit) {
        return { docName: "Manual edit", hasManualEdit: true };
    }
    const firstSource = person.name.sources[0]?.doc_name ?? "document";
    return { docName: firstSource, hasManualEdit: false };
}

function PersonCard({
    person,
    index,
    isEditMode,
    onFieldSave,
}: {
    person: PersonEntry;
    index: number;
    isEditMode?: boolean;
    onFieldSave?: (path: string, value: string) => Promise<void>;
}) {
    const name = String(person.name.value);
    const initials = name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);

    if (isEditMode && onFieldSave) {
        const editableFields = [
            { label: "Name", key: "name", value: name },
            { label: "Role", key: "role", value: person.role ? String(person.role.value) : "" },
            { label: "Department", key: "department", value: person.department ? String(person.department.value) : "" },
            { label: "Email", key: "email", value: person.email ? String(person.email.value) : "" },
            { label: "Phone", key: "phone", value: person.phone ? String(person.phone.value) : "" },
        ];

        return (
            <div className="p-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-muted/50 space-y-3">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-xs shrink-0">
                        {initials}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-foreground">{name}</span>
                        <PriorityBadge priority={person.name.priority} />
                    </div>
                </div>
                <div className="space-y-2.5">
                    {editableFields.map(({ label, key, value: val }) => (
                        <div key={key}>
                            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                                {label}
                            </span>
                            <PersonFieldEditor
                                path={`people.${index}.${key}`}
                                initialValue={val}
                                onSave={onFieldSave}
                            />
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    const { docName, hasManualEdit } = getPersonSource(person);

    return (
        <div className="p-4 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
            <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
                    {initials}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-semibold text-foreground truncate">{name}</h4>
                        <VisibilityBadge visibility={person.name.visibility} />
                        <PriorityBadge priority={person.name.priority} />
                    </div>

                    {person.role && (
                        <div className="flex items-center gap-1.5 mt-1">
                            <Building className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span className="text-sm text-muted-foreground truncate">{String(person.role.value)}</span>
                            {person.role.priority === "manual_override" && (
                                <PriorityBadge priority={person.role.priority} />
                            )}
                        </div>
                    )}

                    {person.department && (
                        <p className="text-xs text-muted-foreground mt-1 ml-5">
                            {String(person.department.value)}
                        </p>
                    )}

                    <div className="flex items-center gap-3 mt-3 flex-wrap">
                        {person.email && (
                            <a
                                href={`mailto:${String(person.email.value)}`}
                                className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 flex items-center gap-1"
                            >
                                <Mail className="w-3 h-3 shrink-0" />
                                <span className="truncate max-w-[140px]">
                                    {String(person.email.value)}
                                </span>
                            </a>
                        )}

                        {person.phone && (
                            <a
                                href={`tel:${String(person.phone.value)}`}
                                className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 flex items-center gap-1"
                            >
                                <Phone className="w-3 h-3 shrink-0" />
                                <span>{String(person.phone.value)}</span>
                            </a>
                        )}
                    </div>

                    <div className="flex items-center gap-2 mt-2">
                        <ConfidenceBadge confidence={person.name.confidence} />
                        <span className={`text-[10px] ${hasManualEdit ? "text-violet-600 dark:text-violet-400 font-semibold" : "text-muted-foreground"}`}>
                            {hasManualEdit ? "Manual edit" : `from ${docName}`}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}
