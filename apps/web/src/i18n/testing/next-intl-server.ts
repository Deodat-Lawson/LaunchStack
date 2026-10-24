/**
 * What `next-intl/server` resolves to under jest: English, the catalogue a
 * test reads its expectations in. See ./next-intl.tsx.
 */

import { createFormatter, createTranslator } from "use-intl";

import { englishMessages } from "~/i18n/messages";

export async function getLocale() {
    return "en" as const;
}

export async function getTranslations(namespaceOrOptions?: string | { namespace?: string }) {
    const namespace =
        typeof namespaceOrOptions === "string" ? namespaceOrOptions : namespaceOrOptions?.namespace;
    return createTranslator({
        locale: "en",
        messages: englishMessages,
        namespace: namespace as never,
    });
}

export async function getFormatter() {
    return createFormatter({ locale: "en" });
}

export async function getMessages() {
    return englishMessages;
}

export async function getTimeZone() {
    return undefined;
}

export async function getNow() {
    return new Date();
}

export function setRequestLocale(): void {}

export function getRequestConfig<T>(create: T): T {
    return create;
}
