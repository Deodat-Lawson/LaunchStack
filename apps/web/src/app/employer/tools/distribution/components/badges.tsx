"use client";

import { Badge } from "~/components/ui/badge";

import { STAGE_LABELS, type RelationshipStage } from "../api";

export function StageBadge({ stage }: { stage: RelationshipStage }) {
    const variant =
        stage === "active" || stage === "contracted"
            ? "success"
            : stage === "declined" || stage === "dormant"
              ? "secondary"
              : stage === "candidate" || stage === "researched"
                ? "outline"
                : "info";
    return <Badge variant={variant}>{STAGE_LABELS[stage]}</Badge>;
}

export function FitBadge({ score }: { score: number | null }) {
    if (score === null) return <Badge variant="outline">unscored</Badge>;
    const variant = score >= 70 ? "success" : score >= 40 ? "info" : "warn";
    return (
        <Badge variant={variant} title="Fit score 0–100 from a deterministic rubric">
            fit {score}
        </Badge>
    );
}
