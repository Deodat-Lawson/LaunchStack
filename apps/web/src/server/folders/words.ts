/**
 * Folder sentences in the reader's language, for the routes that answer with
 * them. Apart from the folder module (./index) so a route can word an error
 * without the database, and a test that stubs the folder mutations keeps these.
 */

import type { Copy } from "~/i18n/copy";
import type { Locale } from "~/i18n/locales";
import { localeOfRequest } from "~/i18n/server";
import { wordCopy, wordEnglish } from "~/i18n/translate";
import { folderIssueCopy, folderPathIssue } from "~/lib/folders/path";

/**
 * A FolderError's sentence in `locale`: its copy, or — for an English sentence
 * a caller threw as a string (`~/server/workspace/folder-actions`) — the
 * catalogue's words for it (`sources.server.folders`), else the English as it is.
 */
export function folderErrorText(
    error: { readonly copy?: Copy | null; readonly message: string },
    locale: Locale
): string {
    return error.copy
        ? wordCopy(error.copy, locale)
        : wordEnglish(error.message, "sources.server.folders", locale);
}

/**
 * Why a path is not acceptable as a folder, in the language of the person
 * behind `request` (English without one), or null when it is.
 */
export function describeFolderPathProblem(path: string, request?: Request): string | null {
    const issue = folderPathIssue(path);
    if (!issue) return null;
    return wordCopy(folderIssueCopy(issue), request ? localeOfRequest(request) : "en");
}
