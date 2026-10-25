/**
 * The deterministic starters in the reader's language, from the
 * `chat.starters.generated` catalogue. Server-only: the route resolves the
 * locale from the request and hands it to `getAskStarters`.
 */

import { createFormatter, createTranslator } from "next-intl";

import type { Locale } from "~/i18n/locales";
import { loadMessages } from "~/i18n/messages";

import { ENGLISH_STARTER_WORDS, type BriefDocument, type StarterWords } from "./starters";

export async function starterWords(locale: Locale, now: Date = new Date()): Promise<StarterWords> {
    // The English set is the one the tests and the model padding were written
    // against; it stays the code path for English readers.
    if (locale === "en") return ENGLISH_STARTER_WORDS;
    const messages = await loadMessages(locale);
    const t = createTranslator({
        locale,
        messages,
        namespace: "chat.starters.generated",
    });
    const format = createFormatter({ locale, now });
    const age = (doc: BriefDocument) =>
        doc.createdAt ? format.relativeTime(doc.createdAt, now) : doc.ageLabel;
    return {
        thisCompany: t("thisCompany"),
        acrossSources: count => t("acrossSources", { count }),
        acrossYourSources: t("acrossYourSources"),
        from: title => t("from", { title }),
        added: doc => t("added", { age: age(doc) }),
        folderAge: doc => t("folderAge", { folder: doc.folder, age: age(doc) }),
        sourcesIn: (count, folder) => t("sourcesIn", { count, folder }),
        summarize: title => t("summarize", { title }),
        keyDates: folder => t("keyDates", { folder }),
        whatDoes: name => t("whatDoes", { name }),
        mainPoints: title => t("mainPoints", { title }),
        themes: { question: t("themes.question"), hint: t("themes.hint") },
        people: { question: t("people.question"), hint: t("people.hint") },
        recent: { question: t("recent.question"), hint: t("recent.hint") },
    };
}
