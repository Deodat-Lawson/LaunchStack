"use client";

/**
 * The slim line above the Ask composer about your AI allowance: amber from
 * 80% of the limit that binds you, red once it is reached (when the panel
 * also stops sending). Nothing at all below 80% or with no limit.
 */

import React from "react";
import { useTranslations } from "next-intl";
import { Ban, Gauge } from "lucide-react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

import {
    ALLOWANCE_WARN_PERCENT,
    useAllowanceFormat,
    type AiAllowance,
} from "./settings/aiAllowance";

export function ChatAllowanceNotice({
    allowance,
    onOpenDetails,
    className,
    style,
}: {
    allowance: AiAllowance | null;
    /** Opens Settings › Account, where the allowance is spelled out. */
    onOpenDetails?: () => void;
    className?: string;
    /** Layout only (the chat column's width); colours come from the tone. */
    style?: React.CSSProperties;
}) {
    const t = useTranslations("chat.aiAllowance");
    const format = useAllowanceFormat();
    if (!allowance) return null;
    const blocked = allowance.blocked;
    const percent = allowance.percent;
    if (!blocked && (percent === null || percent < ALLOWANCE_WARN_PERCENT)) return null;

    const date = format.shortDate(allowance.resetsAt);
    const Icon = blocked ? Ban : Gauge;
    return (
        <div
            role={blocked ? "alert" : "status"}
            data-testid="ai-allowance-notice"
            data-tone={blocked ? "danger" : "warn"}
            className={cn(
                "flex items-start gap-2 rounded-lg border px-3 py-2 text-[12.5px] leading-snug",
                blocked
                    ? "border-danger/40 bg-danger-soft text-danger-ink"
                    : "border-warn/40 bg-warn-soft text-warn-ink",
                className
            )}
            style={style}
        >
            <Icon className="mt-px size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
                {blocked
                    ? allowance.binding === "server"
                        ? t("blockedServer", { date })
                        : t("blockedWorkspace", { date })
                    : t("nearLimit", { percent: format.percent(percent ?? 0), date })}
            </span>
            {onOpenDetails && (
                <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto shrink-0 p-0 text-[12.5px] text-current underline"
                    onClick={onOpenDetails}
                >
                    {t("details")}
                </Button>
            )}
        </div>
    );
}
