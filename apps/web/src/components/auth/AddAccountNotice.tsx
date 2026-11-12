"use client";

import Link from "next/link";
import { Info } from "lucide-react";
import { useTranslations } from "next-intl";

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
                <Link href="/workspaces" className="text-brand font-semibold hover:underline">
                    {t("back")}
                </Link>
            </div>
        </div>
    );
}
