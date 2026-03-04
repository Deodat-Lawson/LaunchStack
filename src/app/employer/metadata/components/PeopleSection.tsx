"use client";

import React from "react";
import { Users, Mail, Phone, Building } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "~/app/employer/documents/components/ui/card";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { VisibilityBadge } from "./VisibilityBadge";
import type { PersonEntry } from "~/lib/tools/company-metadata/types";

interface PeopleSectionProps {
    people: PersonEntry[];
}

export function PeopleSection({ people }: PeopleSectionProps) {
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
                        <PersonCard key={index} person={person} />
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}

function PersonCard({ person }: { person: PersonEntry }) {
    const name = String(person.name.value);
    const initials = name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);

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
                    </div>

                    {person.role && (
                        <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1">
                            <Building className="w-3 h-3" />
                            <span className="truncate">{String(person.role.value)}</span>
                        </p>
                    )}

                    {person.department && (
                        <p className="text-xs text-muted-foreground mt-1">
                            {String(person.department.value)}
                        </p>
                    )}

                    <div className="flex items-center gap-3 mt-3 flex-wrap">
                        {person.email && (
                            <a
                                href={`mailto:${String(person.email.value)}`}
                                className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 flex items-center gap-1"
                            >
                                <Mail className="w-3 h-3" />
                                <span className="truncate max-w-[120px]">
                                    {String(person.email.value)}
                                </span>
                            </a>
                        )}

                        {person.phone && (
                            <a
                                href={`tel:${String(person.phone.value)}`}
                                className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 flex items-center gap-1"
                            >
                                <Phone className="w-3 h-3" />
                                <span>{String(person.phone.value)}</span>
                            </a>
                        )}
                    </div>

                    <div className="flex items-center gap-2 mt-2">
                        <ConfidenceBadge confidence={person.name.confidence} />
                        {person.name.sources.length > 0 && (
                            <span className="text-[10px] text-muted-foreground">
                                from {person.name.sources[0]?.doc_name ?? "document"}
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
