"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

import { useToolFormat } from "~/lib/tools/format";

import { compact, count, percent } from "../brand/_lib/numbers";

/**
 * Growth's words for times, durations, money, numbers and lists, in the
 * interface language: the tools' shared `useToolFormat()` (relative times,
 * short dates, durations, "NL, DE and GB") plus what only Growth prints —
 * a run's spend, Brand's counts, a plain comma list.
 */
export function useGrowthFormat() {
    const tools = useToolFormat();
    const tc = useTranslations("growth.common");
    const format = useFormatter();
    const locale = useLocale();
    return useMemo(() => {
        /** A run's spend, in euros as the providers bill it. */
        const money = (amount: number): string =>
            format.number(amount, {
                style: "currency",
                currency: "EUR",
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            });

        /** "Lead 3, Qualified 2": a plain list with the language's separator. */
        const joinList = (items: string[]): string => items.join(tc("listSeparator"));

        return {
            ...tools,
            money,
            joinList,
            count: (n: number | null | undefined) => count(n, locale),
            compact: (n: number | null | undefined) => compact(n, locale),
            percent,
        };
    }, [tools, tc, format, locale]);
}

export type GrowthFormat = ReturnType<typeof useGrowthFormat>;
