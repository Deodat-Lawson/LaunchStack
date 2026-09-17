import { cn } from "~/lib/utils";

import type { EmailStatusKind } from "../api";

export const EMAIL_STATUS_LABEL: Record<EmailStatusKind, string> = {
    verified: "Verified",
    found: "Found",
    generic: "Generic",
    guess: "Guess",
};

export const EMAIL_STATUS_HELP: Record<EmailStatusKind, string> = {
    verified: "Mailbox confirmed by the provider.",
    found: "Published on a page we fetched; not verified.",
    generic: "A shared inbox such as info@ or sales@.",
    guess: "Built from the company's address pattern. Confirm before using.",
};

/** A word first, colour second: only verified and guess carry colour. */
export function EmailStatus({
    status,
    className,
}: {
    status: EmailStatusKind;
    className?: string;
}) {
    return (
        <span
            title={EMAIL_STATUS_HELP[status]}
            className={cn(
                "inline-flex h-[18px] items-center whitespace-nowrap rounded px-1.5 text-[11px] leading-none",
                status === "verified" && "bg-success-soft text-success",
                status === "guess" && "bg-warn-soft text-warn",
                (status === "found" || status === "generic") && "border-line text-ink-2 border",
                className
            )}
        >
            {EMAIL_STATUS_LABEL[status]}
        </span>
    );
}

export function canOutreach(status: EmailStatusKind): boolean {
    return status === "verified" || status === "found";
}
