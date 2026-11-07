/**
 * Types every `useTranslations` / `getTranslations` call against the English
 * catalogue: a key that does not exist is a compile error, and `useLocale()`
 * is the `Locale` union rather than a string.
 */

import type { Locale } from "./locales";
import type { Messages } from "./messages";

declare module "next-intl" {
    interface AppConfig {
        Locale: Locale;
        Messages: Messages;
    }
}
