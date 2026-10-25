/**
 * Render a tree in a given language, for tests about translation itself.
 * Ordinary component tests need nothing: without a provider they read
 * English (./next-intl.tsx).
 */

import React, { type ReactElement } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import type { Locale } from "~/i18n/locales";
import { englishMessages, mergeMessages } from "~/i18n/messages";
import zhCN from "~/i18n/messages/zh-CN";

const CATALOGUES: Record<Locale, typeof englishMessages> = {
    en: englishMessages,
    "zh-CN": mergeMessages(englishMessages, zhCN),
};

export function renderWithLocale(
    ui: ReactElement,
    locale: Locale,
    options?: Omit<RenderOptions, "wrapper">
) {
    return render(ui, {
        ...options,
        wrapper: ({ children }) => (
            <NextIntlClientProvider locale={locale} messages={CATALOGUES[locale]}>
                {children}
            </NextIntlClientProvider>
        ),
    });
}
