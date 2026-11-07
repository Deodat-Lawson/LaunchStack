"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { useFeedback } from "~/components/feedback/FeedbackProvider";

export default function EmployerError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    const t = useTranslations("chrome.error");
    const tc = useTranslations("common.actions");
    // The boundary sits inside the employer layout, so the dialog is there.
    const feedback = useFeedback();
    const report = () =>
        feedback.open({
            kind: "bug",
            title: t("reportTitle"),
            origin: {
                ...(error.digest ? { errorId: error.digest } : {}),
                ...(error.message ? { message: error.message.slice(0, 300) } : {}),
            },
        });
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
                {feedback.enabled && (
                    <button
                        type="button"
                        onClick={report}
                        data-testid="error-report"
                        className="hover:border-brand border-line text-ink-2 cursor-pointer rounded-full border px-5 py-2.5 text-sm font-semibold transition-colors"
                    >
                        {t("report")}
                    </button>
                )}
            </div>
        </div>
    );
}
