"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";

import type { Copy } from "~/i18n/copy";

export type CopyText = (copy: Copy | null | undefined, english: string) => string;

/**
 * A sentence the server sent as a copy (a message key and its values) beside
 * its English — a run step, a headline, a review finding — in the reader's
 * language; the English as it came when there is no copy (an older server,
 * the dev simulator) or this build's catalogue does not know the key.
 *
 *   const word = useCopyText();
 *   <span>{word(step.labelCopy, step.label)}</span>
 */
export function useCopyText(): CopyText {
    const t = useTranslations();
    return useCallback(
        (copy, english) => (copy && t.has(copy.key) ? t(copy.key, copy.values as never) : english),
        [t]
    );
}
