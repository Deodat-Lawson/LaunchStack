/**
 * The shared file's words on the public page, rendered on the server.
 *
 * Every public page carries the file's text in its HTML (ADR-016): below the
 * preview as "Text version", or in place of a preview for the types a
 * browser cannot show (presentations, archives, unknown files — never sent to
 * Office Online, which would hand a secret link's bytes to a third party).
 * That way an AI agent fetching the page, a reader with scripts off and a
 * screen reader all get the words without running the viewer.
 */

import { Download, FileQuestion, FileText, Info } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "~/components/ui/button";
import { ViewerNotice } from "~/app/employer/documents/components/ViewerNotice";
import type { DocumentDisplayType } from "~/app/employer/documents/types/document";
import type { PublicDocumentText } from "~/server/public-share/document";

import { PublicMarkdown } from "./PublicMarkdown";

/** Types the page shows as text instead of a preview. */
export const TEXT_ONLY_TYPES = ["pptx", "zip", "unknown"] as const;
export type TextOnlyType = (typeof TEXT_ONLY_TYPES)[number];

export function isTextOnlyType(type: DocumentDisplayType): type is TextOnlyType {
    return (TEXT_ONLY_TYPES as readonly string[]).includes(type);
}

const CSV_MIME = /^(?:text|application)\/csv\b/i;

/**
 * How the page shows a file: as the server classified it, except a CSV,
 * which reads best as a table — the spreadsheet viewer parses it, where a
 * frame would only try to download it.
 */
export function shownAs(file: {
    displayType: DocumentDisplayType;
    mimeType: string | null;
    title: string;
}): DocumentDisplayType {
    const csv = CSV_MIME.test(file.mimeType ?? "") || /\.csv$/i.test(file.title.trim());
    return file.displayType === "text" && csv ? "xlsx" : file.displayType;
}

/**
 * Text that is data rather than prose (a CSV's rows) as one code block, so
 * its lines stay lines instead of running together as a paragraph.
 */
export function asCodeBlock(text: PublicDocumentText, language: string): PublicDocumentText {
    if (!text.available) return text;
    let fence = "```";
    while (text.markdown.includes(fence)) fence += "`";
    return {
        ...text,
        markdown: `${fence}${language}\n${text.markdown.replace(/\n$/, "")}\n${fence}`,
    };
}

/**
 * The most text the page itself renders. The Markdown address carries the
 * whole text (up to the server's own cap); a page this long is for reading,
 * and longer would only make it slow.
 */
export const PAGE_TEXT_MAX_CHARS = 200_000;

/** The text to render, cut at a paragraph (or line) near the cap when it is longer. */
export function pageText(markdown: string): { markdown: string; cut: boolean } {
    if (markdown.length <= PAGE_TEXT_MAX_CHARS) return { markdown, cut: false };
    const head = markdown.slice(0, PAGE_TEXT_MAX_CHARS);
    const floor = PAGE_TEXT_MAX_CHARS * 0.8;
    const paragraph = head.lastIndexOf("\n\n");
    const line = head.lastIndexOf("\n");
    const end = paragraph > floor ? paragraph : line > floor ? line : PAGE_TEXT_MAX_CHARS;
    return { markdown: head.slice(0, end), cut: true };
}

/** The text, or a line saying there is none, and a note where it stops early. */
export function PublicTextBody({
    text,
    markdownUrl,
}: {
    text: PublicDocumentText;
    markdownUrl: string;
}) {
    const t = useTranslations("publicShare.page");
    if (!text.available) {
        return <p className="text-ink-3 text-sm">{t("noText")}</p>;
    }
    const shown = pageText(text.markdown);
    return (
        <>
            <PublicMarkdown markdown={shown.markdown} />
            {(shown.cut || text.truncated) && (
                <p className="border-line text-ink-3 mt-8 border-t pt-3 text-xs">
                    {shown.cut
                        ? t.rich("truncatedOnPage", {
                              link: chunks => (
                                  <a
                                      href={markdownUrl}
                                      className="text-brand-ink underline underline-offset-2"
                                  >
                                      {chunks}
                                  </a>
                              ),
                          })
                        : t("truncated")}
                </p>
            )}
        </>
    );
}

/** "Text version": below the preview, open, so the words are on the page as well as in it. */
export function PublicTextSection({
    text,
    markdownUrl,
}: {
    text: PublicDocumentText;
    markdownUrl: string;
}) {
    const t = useTranslations("publicShare.page");
    return (
        <section aria-labelledby="public-text-version" className="border-line bg-surface border-t">
            <details open className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
                <summary className="text-ink hover:text-brand-ink flex cursor-pointer items-center gap-2 text-sm font-semibold">
                    <FileText className="text-ink-3 size-4 shrink-0" aria-hidden />
                    <h2 id="public-text-version" className="inline">
                        {t("textVersion")}
                    </h2>
                </summary>
                <p className="text-ink-3 mt-1 text-xs">{t("textVersionHint")}</p>
                <div className="mt-6">
                    <PublicTextBody text={text} markdownUrl={markdownUrl} />
                </div>
            </details>
        </section>
    );
}

/** A file with no preview here: why, then its text (or how to get the file instead). */
export function PublicNoPreview({
    displayType,
    text,
    markdownUrl,
    downloadUrl,
}: {
    displayType: TextOnlyType;
    text: PublicDocumentText;
    markdownUrl: string;
    downloadUrl: string | null;
}) {
    const t = useTranslations("publicShare.page");
    const download = downloadUrl ? (
        <Button asChild size="sm" variant="outline">
            <a href={downloadUrl} download rel="nofollow">
                <Download aria-hidden />
                {t("download")}
            </a>
        </Button>
    ) : null;

    if (!text.available) {
        // Grows to fill the page below the bar, so the notice sits in the middle.
        return (
            <div className="flex flex-1 flex-col [&>*]:flex-1">
                <ViewerNotice
                    tone="warn"
                    icon={<FileQuestion />}
                    title={t("noPreviewTitle")}
                    detail={downloadUrl ? t("noPreviewNoTextDownload") : t("noPreviewNoTextAsk")}
                    action={download}
                />
            </div>
        );
    }

    return (
        <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
            <div
                role="note"
                className="border-line bg-panel text-ink-2 mb-8 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5 text-sm"
            >
                <Info className="text-ink-3 size-4 shrink-0" aria-hidden />
                <p className="min-w-0 flex-1 basis-56">{t(`noPreview.${displayType}`)}</p>
                {download}
            </div>
            <PublicTextBody text={text} markdownUrl={markdownUrl} />
        </div>
    );
}
