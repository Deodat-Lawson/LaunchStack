/**
 * next-intl's per-request configuration (wired in next.config.ts). There is
 * no locale in the URL: the language is a preference, like the theme, so
 * links and bookmarks stay the same whichever one a person reads in.
 */

import { getRequestConfig } from "next-intl/server";
import { IntlErrorCode, type IntlError } from "next-intl";

import { getRequestLocale, getRequestTimeZone } from "./server";
import { loadMessages } from "./messages";

function onError(error: IntlError): void {
    // No time zone on the very first request is expected (./TimeZoneSync
    // writes the cookie); everything else is a bug worth seeing in dev.
    if (error.code === IntlErrorCode.ENVIRONMENT_FALLBACK) return;
    if (process.env.NODE_ENV !== "production") console.error(error);
}

export default getRequestConfig(async () => {
    const locale = await getRequestLocale();
    return {
        locale,
        messages: await loadMessages(locale),
        timeZone: await getRequestTimeZone(),
        onError,
    };
});
