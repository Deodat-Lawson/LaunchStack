"use client";

import { Bug, Lightbulb } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "~/components/ui/badge";
import type { BugSeverity, FeedbackKind, FeedbackStatus } from "~/lib/feedback/contract";
import { cn } from "~/lib/utils";

const STATUS_VARIANT: Record<
    FeedbackStatus,
    "info" | "outline" | "warn" | "success" | "secondary"
> = {
    new: "info",
    planned: "outline",
    in_progress: "warn",
    done: "success",
    wont_do: "secondary",
};

export function StatusBadge({ status, className }: { status: FeedbackStatus; className?: string }) {
    const t = useTranslations("feedback.status");
    return (
        <Badge
            variant={STATUS_VARIANT[status]}
            className={className}
            data-testid="feedback-status"
            data-status={status}
        >
            {t(status)}
        </Badge>
    );
}

export function SeverityBadge({ severity }: { severity: BugSeverity }) {
    const t = useTranslations("feedback.severity");
    return <Badge variant={severity === "blocking" ? "danger" : "secondary"}>{t(severity)}</Badge>;
}

export function KindIcon({ kind, className }: { kind: FeedbackKind; className?: string }) {
    const t = useTranslations("feedback.kind");
    const Icon = kind === "bug" ? Bug : Lightbulb;
    return (
        <Icon
            className={cn(
                "size-4 shrink-0",
                kind === "bug" ? "text-danger" : "text-warn-ink",
                className
            )}
            aria-label={t(kind)}
            role="img"
        />
    );
}
