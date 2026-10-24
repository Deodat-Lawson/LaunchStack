import { useTranslations } from "next-intl";

import { cn } from "~/lib/utils";

import type { EmailStatusKind } from "../api";

/** Every status, in the order the People filter lists them. */
export const EMAIL_STATUSES: readonly EmailStatusKind[] = ["verified", "found", "generic", "guess"];

/*
 * A status's word and its explanation are `growth.prospects.emailStatus.label.<status>`
 * and `.help.<status>` in the catalogue.
 */

/** A word first, colour second: only verified and guess carry colour. */
export function EmailStatus({
    status,
    className,
}: {
    status: EmailStatusKind;
    className?: string;
}) {
    const t = useTranslations("growth.prospects.emailStatus");
    return (
        <span
            title={t(`help.${status}`)}
            className={cn(
                "inline-flex h-[18px] items-center whitespace-nowrap rounded px-1.5 text-[11px] leading-none",
                status === "verified" && "bg-success-soft text-success",
                status === "guess" && "bg-warn-soft text-warn",
                (status === "found" || status === "generic") && "border-line text-ink-2 border",
                className
            )}
        >
            {t(`label.${status}`)}
        </span>
    );
}

export function canOutreach(status: EmailStatusKind): boolean {
    return status === "verified" || status === "found";
}
