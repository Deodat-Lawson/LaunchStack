"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";

import { useCopyText } from "~/lib/tools/copyText";

import type { SegmentSummary } from "../prospects/api";
import { useGrowthFormat } from "./format";

/**
 * A segment's subtitle ("NL, DE · Distributors, Retailers") and headline
 * ("Distributors and Retailers in NL and DE") made from its words, in the
 * reader's language.
 */
export function useSegmentText(): (
    segment: Pick<SegmentSummary, "subtitle" | "headline" | "words">
) => { subtitle: string; headline: string } {
    const word = useCopyText();
    const t = useTranslations("growth.server.segment");
    const { joinList, joinNatural } = useGrowthFormat();
    return useCallback(
        segment => {
            const words = segment.words;
            if (!words) return { subtitle: segment.subtitle, headline: segment.headline };
            const kinds = joinList(words.kinds.map(kind => word(kind, "")));
            return {
                subtitle: t("subtitle", { countries: joinList(words.countries), kinds }),
                headline: t("headline", { kinds, countries: joinNatural(words.countries) }),
            };
        },
        [word, t, joinList, joinNatural]
    );
}
