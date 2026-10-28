"use client";

/**
 * Settings › Account › Your AI allowance this month.
 *
 * Every member sees their own: what they used against the limit that binds
 * them, when it resets, and who can change it — a workspace admin for the
 * workspace's limit, whoever runs the server for the server's. With no limit,
 * it says so and still shows what they used.
 */

import React from "react";
import { useTranslations } from "next-intl";

import { Card, Section } from "~/components/layout/page-shell";
import { cn } from "~/lib/utils";

import {
    AllowanceBar,
    allowanceTone,
    bindingLimit,
    useAiAllowance,
    useAllowanceFormat,
    type AiAllowance,
    type AllowanceTone,
} from "./aiAllowance";
import { StatusNote } from "./ui";

const TONE_TEXT: Record<AllowanceTone, string> = {
    normal: "text-ink-2",
    warn: "text-warn-ink",
    danger: "text-danger-ink",
};

export function AiAllowanceCard() {
    const t = useTranslations("settings.account.aiAllowance");
    const tc = useTranslations("common");
    const { allowance, loaded, problem } = useAiAllowance();

    return (
        <Section title={t("title")} description={t("description")}>
            <Card>
                {allowance ? (
                    <AllowanceSummary allowance={allowance} />
                ) : !loaded ? (
                    <StatusNote tone="muted" style={{ marginBottom: 0 }}>
                        {tc("status.loading")}
                    </StatusNote>
                ) : (
                    <StatusNote tone="danger" style={{ marginBottom: 0 }}>
                        {problem?.message ??
                            (problem?.status
                                ? t("loadFailedStatus", { status: problem.status })
                                : t("loadFailed"))}
                    </StatusNote>
                )}
            </Card>
        </Section>
    );
}

function AllowanceSummary({ allowance }: { allowance: AiAllowance }) {
    const t = useTranslations("settings.account.aiAllowance");
    const format = useAllowanceFormat();
    const binding = bindingLimit(allowance);

    if (!binding || allowance.percent === null) {
        return (
            <div data-testid="ai-allowance-summary">
                <div className="text-ink text-[22px] font-semibold leading-tight tracking-tight">
                    {t("noLimit")}
                </div>
                <p className="text-ink-3 m-0 mt-1.5 text-[12.5px] leading-normal">
                    {t("noLimitBody", { used: format.tokens(allowance.used) })}
                </p>
            </div>
        );
    }

    const percent = allowance.percent;
    const tone = allowanceTone(percent, allowance.blocked);
    const source =
        binding.source === "server"
            ? t("sourceServer")
            : binding.source === "member"
              ? t("sourceMember")
              : t("sourceDefault");
    // The other limit, when there is one: a person under both should know.
    const other =
        binding.source === "server"
            ? allowance.workspace.limit !== null
                ? t("alsoWorkspace", {
                      limit: format.tokens(allowance.workspace.limit),
                      used: format.tokens(allowance.used),
                  })
                : t("usedHere", { used: format.tokens(allowance.used) })
            : allowance.server
              ? t("alsoServer", {
                    limit: format.tokens(allowance.server.limit),
                    used: format.tokens(allowance.server.used),
                })
              : null;

    return (
        <div data-testid="ai-allowance-summary" data-tone={tone}>
            <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
                <div className="min-w-0">
                    <div
                        className={cn(
                            "text-[28px] font-semibold tabular-nums leading-none tracking-tight",
                            tone === "danger" ? "text-danger-ink" : "text-ink"
                        )}
                    >
                        {format.compact(binding.used)}
                    </div>
                    <div className="text-ink-3 mt-1.5 text-[12px]">
                        {t("usedOf", {
                            used: format.tokens(binding.used),
                            limit: format.tokens(binding.limit),
                        })}
                    </div>
                </div>
                <div
                    className={cn("shrink-0 text-[13px] font-medium tabular-nums", TONE_TEXT[tone])}
                >
                    {t("percentUsed", { percent: format.percent(percent) })}
                </div>
            </div>
            <AllowanceBar
                percent={percent}
                blocked={allowance.blocked}
                label={t("progressLabel", { percent: format.percent(percent) })}
                className="mt-3"
            />
            <div className="text-ink-2 mt-3 flex flex-col gap-1 text-[12.5px] leading-normal">
                <span>{t("resets", { date: format.longDate(allowance.resetsAt) })}</span>
                <span>{source}</span>
                {other && <span className="text-ink-3">{other}</span>}
            </div>
            {allowance.blocked && (
                <div className="mt-3">
                    <StatusNote tone="danger" style={{ marginBottom: 0 }}>
                        {t("reached")}
                    </StatusNote>
                </div>
            )}
        </div>
    );
}
