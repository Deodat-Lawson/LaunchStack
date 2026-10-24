/**
 * What `next-intl` resolves to under jest (jest.config.js moduleNameMapper).
 *
 * A component test that renders without a provider gets the English
 * catalogue — the same words the component showed before it was translated,
 * so `getByText("Delete")` keeps working and no test has to mount a
 * provider it does not care about. A test about another language wraps the
 * tree in `NextIntlClientProvider` (or `renderWithLocale` from ./render) and
 * gets the real thing.
 *
 * A missing key throws here, where in the app it would render the key.
 */

import React, { createContext, useContext, type ReactNode } from "react";
import {
    IntlError,
    IntlErrorCode,
    IntlProvider,
    createFormatter,
    createTranslator,
    hasLocale,
    useFormatter as useIntlFormatter,
    useLocale as useIntlLocale,
    useMessages as useIntlMessages,
    useNow as useIntlNow,
    useTimeZone as useIntlTimeZone,
    useTranslations as useIntlTranslations,
} from "use-intl";

import { englishMessages } from "~/i18n/messages";

export { IntlError, IntlErrorCode, createFormatter, createTranslator, hasLocale };

const InProvider = createContext(false);

function throwOnError(error: IntlError): void {
    throw error;
}

type ProviderProps = Partial<React.ComponentProps<typeof IntlProvider>> & { children?: ReactNode };

export function NextIntlClientProvider({
    children,
    locale = "en",
    messages = englishMessages,
    onError = throwOnError,
    ...rest
}: ProviderProps) {
    return (
        <InProvider.Provider value>
            <IntlProvider locale={locale} messages={messages} onError={onError} {...rest}>
                {children}
            </IntlProvider>
        </InProvider.Provider>
    );
}

const translators = new Map<string, unknown>();

function englishTranslator(namespace?: string) {
    const key = namespace ?? "";
    let translator = translators.get(key);
    if (!translator) {
        translator = createTranslator({
            locale: "en",
            messages: englishMessages,
            namespace: namespace as never,
            onError: throwOnError,
        });
        translators.set(key, translator);
    }
    return translator;
}

const englishFormatter = createFormatter({ locale: "en" });

// Whether a provider is mounted never changes for a mounted component, so
// the hook order is stable even though only one branch calls the real hook.
/* eslint-disable react-hooks/rules-of-hooks */
export const useTranslations = ((namespace?: string) =>
    useContext(InProvider)
        ? useIntlTranslations(namespace as never)
        : englishTranslator(namespace)) as typeof useIntlTranslations;

export const useLocale = (() =>
    useContext(InProvider) ? useIntlLocale() : "en") as typeof useIntlLocale;

export const useFormatter = (() =>
    useContext(InProvider) ? useIntlFormatter() : englishFormatter) as typeof useIntlFormatter;

export const useMessages = (() =>
    useContext(InProvider) ? useIntlMessages() : englishMessages) as typeof useIntlMessages;

export const useNow = ((options?: Parameters<typeof useIntlNow>[0]) =>
    useContext(InProvider) ? useIntlNow(options) : new Date()) as typeof useIntlNow;

export const useTimeZone = (() =>
    useContext(InProvider) ? useIntlTimeZone() : undefined) as typeof useIntlTimeZone;
/* eslint-enable react-hooks/rules-of-hooks */
