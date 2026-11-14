"use client";

import { useTranslations } from "next-intl";

import { FitMeter } from "~/components/tools/FitMeter";

import type { CompanyRow } from "../api";

/**
 * A company's fit, or — when the fit check ruled it out — a "Ruled out" mark
 * whose title is the reason. A rejection is stored as a score of 0, and "0"
 * read as a broken score rather than a decision.
 */
export function FitCell({ c }: { c: CompanyRow }) {
    const t = useTranslations("growth.prospects.companies");
    if (c.ruledOut)
        return (
            <span
                className="border-line text-ink-3 inline-flex rounded border px-1.5 py-px text-[11px] font-medium"
                title={c.ruledOut}
            >
                {t("ruledOut")}
            </span>
        );
    return <FitMeter value={c.fit} threshold={c.fitThreshold} />;
}

/** The line under a company's name: why it fits, or why it was ruled out. */
export function useWhyLine(): (c: CompanyRow, why: string) => string {
    const t = useTranslations("growth.prospects.companies");
    return (c, why) => (c.ruledOut ? t("ruledOutWhy", { reason: c.ruledOut }) : why);
}
