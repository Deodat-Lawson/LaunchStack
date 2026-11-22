"use client";

/**
 * Small pieces every screen of the template shares: where its screens are,
 * how it prints money and dates, and how a status looks. A real tool keeps
 * these in `_lib/` and `_components/` beside its screens.
 */

import { useFormatter, useTranslations } from "next-intl";
import { useMemo, type ReactElement } from "react";

import { Badge } from "~/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { useToolFormat } from "~/lib/tools/format";

import type { ContractStatus } from "./data";

/** The tool's screens, as app-relative paths. One place, so links never drift. */
export const paths = {
    overview: () => "/",
    contracts: (query?: string) => `/contracts${query ? `?${query}` : ""}`,
    contract: (id: string) => `/contracts/${encodeURIComponent(id)}`,
    create: () => "/new",
    settings: () => "/settings",
};

/** First path segments that are this tool's screens ("/" is always its own). */
export const ROOTS = ["contracts", "new", "settings"] as const;

/**
 * Money, dates and day counts in the interface language. The shared
 * `useToolFormat()` brings relative times and short dates; this adds what
 * only this tool prints.
 */
export function useRenewalsFormat() {
    const tools = useToolFormat();
    const format = useFormatter();
    return useMemo(
        () => ({
            ...tools,
            money: (usd: number) =>
                format.number(usd, {
                    style: "currency",
                    currency: "USD",
                    maximumFractionDigits: 0,
                }),
            longDate: (iso: string) =>
                format.dateTime(new Date(`${iso}T12:00:00`), {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                }),
            dayMonth: (iso: string) =>
                format.dateTime(new Date(`${iso}T12:00:00`), { day: "numeric", month: "short" }),
        }),
        [tools, format]
    );
}

/**
 * Status as a chip. One mapping from state to tone for the whole tool:
 * attention is warn, a good outcome success, in progress info, inactive
 * secondary. Never colour alone — the word is always there.
 */
const TONE: Record<ContractStatus, "warn" | "secondary" | "info" | "outline"> = {
    decide: "warn",
    auto: "secondary",
    renewing: "info",
    ending: "outline",
};

export function StatusBadge({ status }: { status: ContractStatus }) {
    const t = useTranslations("designTemplate.status");
    return <Badge variant={TONE[status]}>{t(status)}</Badge>;
}

/**
 * An icon-only button names itself twice: `aria-label` for a screen reader,
 * a tooltip with the same words for everyone else.
 */
export function IconTooltip({ label, children }: { label: string; children: ReactElement }) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>{children}</TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}
