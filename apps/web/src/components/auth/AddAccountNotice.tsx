"use client";

import Link from "next/link";
import { AlertCircle, Info } from "lucide-react";
import { useTranslations } from "next-intl";

import { MAX_DEVICE_ACCOUNTS } from "~/lib/auth/device-accounts";

/**
 * On /signin?add=1 and /signup?add=1: says the person signing in as someone
 * else stays signed in as who they are now, and gives them a way back.
 */
export function AddAccountNotice({ email }: { email: string }) {
    const t = useTranslations("auth.addAccount");
    return (
        <div
            role="status"
            className="bg-info-soft border-info/25 text-ink-2 mb-4 flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[12.5px] leading-normal"
        >
            <Info className="text-info-ink mt-px size-4 shrink-0" aria-hidden />
            <div>
                {t.rich("staySignedIn", {
                    email,
                    b: chunks => <b className="text-ink font-medium">{chunks}</b>,
                })}{" "}
                <BackLink />
            </div>
        </div>
    );
}

/**
 * In place of the form when this browser already holds the most accounts it
 * keeps: another sign-in would replace the active account instead of joining
 * the list, and switching away from it would sign it out.
 */
export function AccountLimitNotice() {
    const t = useTranslations("auth.addAccount");
    return (
        <div
            role="status"
            className="bg-warn-soft border-warn/30 text-ink-2 mb-4 flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[12.5px] leading-normal"
        >
            <AlertCircle className="text-warn-ink mt-px size-4 shrink-0" aria-hidden />
            <div>
                {t("limit", { max: MAX_DEVICE_ACCOUNTS })} <BackLink />
            </div>
        </div>
    );
}

function BackLink() {
    const t = useTranslations("auth.addAccount");
    return (
        <Link href="/workspaces" className="text-brand font-semibold hover:underline">
            {t("back")}
        </Link>
    );
}
