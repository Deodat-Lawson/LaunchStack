"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

export default function EmployerError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    const t = useTranslations("chrome.error");
    const tc = useTranslations("common.actions");
    return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
            <h2 className="text-ink mb-2 text-2xl font-bold">{t("title")}</h2>
            <p className="text-ink-3 mb-6 max-w-md">{t("body")}</p>
            {error.digest && (
                <p className="text-ink-4 mb-4 text-xs">{t("errorId", { id: error.digest })}</p>
            )}
            <div className="flex gap-3">
                <button
                    onClick={reset}
                    className="bg-brand hover:bg-brand-hi text-brand-fg cursor-pointer rounded-full px-5 py-2.5 text-sm font-semibold transition-colors"
                >
                    {tc("tryAgain")}
                </button>
                <Link
                    href="/employer/documents"
                    className="hover:border-brand border-line text-ink-2 rounded-full border px-5 py-2.5 text-sm font-semibold transition-colors"
                >
                    {t("backToDashboard")}
                </Link>
            </div>
        </div>
    );
}
