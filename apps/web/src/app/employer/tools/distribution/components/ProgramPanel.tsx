"use client";

import { Pencil } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";

import { KIND_LABELS } from "../api";
import type { DistributionState } from "../useDistribution";

export function ProgramPanel({ state, onEdit }: { state: DistributionState; onEdit: () => void }) {
    const p = state.program;
    if (!p) return null;
    return (
        <Card className="bg-panel border-none p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h2 className="text-ink text-base font-semibold">{p.name}</h2>
                    <p className="text-ink-2 mt-1 max-w-3xl text-sm">{p.offering}</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={onEdit}>
                        <Pencil className="h-4 w-4" /> Edit
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                            void state.updateProgram(p.id, {
                                status: p.status === "active" ? "archived" : "active",
                            })
                        }
                    >
                        {p.status === "active" ? "Archive" : "Reactivate"}
                    </Button>
                </div>
            </div>
            <dl className="mt-4 grid gap-4 text-sm md:grid-cols-2">
                <div>
                    <dt className="text-ink-3 text-[10px] font-bold uppercase tracking-widest">
                        Partner kinds
                    </dt>
                    <dd className="mt-1 flex flex-wrap gap-1">
                        {p.partnerKinds.map(k => (
                            <Badge key={k} variant="secondary">
                                {KIND_LABELS[k]}
                            </Badge>
                        ))}
                    </dd>
                </div>
                <div>
                    <dt className="text-ink-3 text-[10px] font-bold uppercase tracking-widest">
                        Territories
                    </dt>
                    <dd className="mt-1 flex flex-wrap gap-1">
                        {p.targetTerritories.map((t, i) => (
                            <Badge key={i} variant="outline">
                                {t.region ? `${t.region}, ` : ""}
                                {t.country}
                                {t.radiusMeters ? ` · ${Math.round(t.radiusMeters / 1000)} km` : ""}
                            </Badge>
                        ))}
                    </dd>
                </div>
                <div>
                    <dt className="text-ink-3 text-[10px] font-bold uppercase tracking-widest">
                        Categories
                    </dt>
                    <dd className="text-ink-2 mt-1">{p.categories.join(", ") || "—"}</dd>
                </div>
                <div>
                    <dt className="text-ink-3 text-[10px] font-bold uppercase tracking-widest">
                        HS codes
                    </dt>
                    <dd className="text-ink-2 mt-1 font-mono">{p.hsCodes.join(", ") || "—"}</dd>
                </div>
                <div className="md:col-span-2">
                    <dt className="text-ink-3 text-[10px] font-bold uppercase tracking-widest">
                        Constraints
                    </dt>
                    <dd className="text-ink-2 mt-1 whitespace-pre-wrap">
                        {p.constraints?.trim() ? p.constraints : "—"}
                    </dd>
                </div>
                <div className="md:col-span-2">
                    <dt className="text-ink-3 text-[10px] font-bold uppercase tracking-widest">
                        Excluded domains (existing partners)
                    </dt>
                    <dd className="text-ink-2 mt-1 font-mono text-xs">
                        {p.knownPartnerDomains.join(" · ") ||
                            "none yet — import your current partners so discovery never pitches them"}
                    </dd>
                </div>
            </dl>
        </Card>
    );
}
