"use client";

import { useState } from "react";
import { NextIntlClientProvider, useTranslations } from "next-intl";

import { readLocaleChoice } from "~/i18n/client";
import { DEFAULT_LOCALE, negotiateLocale, type Locale } from "~/i18n/locales";
import en from "~/i18n/messages/en/errors.json";
import zhCN from "~/i18n/messages/zh-CN/errors.json";

/**
 * This replaces the root layout when it renders, so nothing above it mounts
 * next-intl. It brings its own: the `errors` catalogue for this browser's
 * choice, else its languages, else English — the order the server uses.
 */
const CATALOGUES: Record<Locale, { errors: typeof en }> = {
    en: { errors: en },
    "zh-CN": { errors: zhCN },
};

function pickLocale(): Locale {
    const chosen = readLocaleChoice()?.locale;
    if (chosen) return chosen;
    const languages =
        typeof navigator === "undefined"
            ? null
            : (navigator.languages?.join(",") ?? navigator.language);
    return negotiateLocale(languages) ?? DEFAULT_LOCALE;
}

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    const [locale] = useState(pickLocale);
    return (
        <html lang={locale}>
            <body className="bg-surface text-ink flex min-h-screen items-center justify-center px-4">
                <NextIntlClientProvider locale={locale} messages={CATALOGUES[locale]}>
                    <GlobalErrorContent digest={error.digest} reset={reset} />
                </NextIntlClientProvider>
            </body>
        </html>
    );
}

function GlobalErrorContent({ digest, reset }: { digest?: string; reset: () => void }) {
    const t = useTranslations("errors.global");
    return (
        <div className="max-w-md text-center">
            <h1 className="text-brand-ink mb-4 text-4xl font-bold">{t("title")}</h1>
            <p className="text-ink-2 mb-6">{t("body")}</p>
            {digest && <p className="text-ink-3 mb-4 text-xs">{t("errorId", { id: digest })}</p>}
            <button
                onClick={reset}
                className="bg-brand text-brand-fg hover:bg-brand-hi cursor-pointer rounded-full px-6 py-3 text-sm font-semibold transition-colors"
            >
                {t("tryAgain")}
            </button>
        </div>
    );
}
