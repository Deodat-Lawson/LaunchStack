/**
 * /s/<token> — a file opened from its public link (ADR-016). No session: the
 * token is the credential, resolved by `resolvePublicLink` exactly as the
 * `/api/s/<token>/…` routes resolve it, and a dead link (unknown, turned off,
 * expired, switched off, file gone) is one "not available" page.
 *
 * Above the fold: a slim bar and the file in the workspace's own viewer,
 * reading only the link's routes. Below it, and in the HTML before any
 * script runs, the file's text, so an agent handed this address can read it
 * without JavaScript (the same text as `/s/<token>.md`). Presentations,
 * archives and unknown files show that text instead of a preview.
 */

import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { LaunchstackMark } from "~/app/_components/LaunchstackLogo";
import {
    loadPublicDocumentRow,
    publicDocumentText,
    toPublicDocument,
} from "~/server/public-share/document";
import { resolvePublicLink } from "~/server/workspace/public-links";

import { PublicFileViewer } from "../_components/PublicFileViewer";
import { PublicHeader } from "../_components/PublicHeader";
import {
    PublicNoPreview,
    PublicTextSection,
    asCodeBlock,
    isTextOnlyType,
    shownAs,
} from "../_components/PublicText";

// Every request reads the link afresh: turning it off works on the next load.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

/** The live link and its file, once per request for both the metadata and the page. */
const loadShare = cache(async (token: string) => {
    const link = await resolvePublicLink(token);
    if (!link) return null;
    const row = await loadPublicDocumentRow(link);
    if (!row) return null;
    return { link, row, doc: await toPublicDocument(link, row) };
});

const NOT_INDEXED = { index: false, follow: false } as const;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { token } = await params;
    const share = await loadShare(token);
    if (!share) {
        // Nothing about a dead token: not whether it ever existed, nor its file.
        const t = await getTranslations("publicShare.page.unavailable");
        return {
            title: { absolute: t("metaTitle") },
            robots: NOT_INDEXED,
            referrer: "no-referrer",
        };
    }
    return {
        title: { absolute: share.doc.title },
        robots: NOT_INDEXED,
        referrer: "no-referrer",
        alternates: { types: { "text/markdown": share.doc.markdownUrl } },
    };
}

export default async function PublicFilePage({ params }: Props) {
    const { token } = await params;
    const share = await loadShare(token);
    if (!share) notFound();
    const { link, row, doc } = share;
    const text = await publicDocumentText(link, row, doc.displayType);
    const displayType = shownAs(doc);
    const header = (
        <PublicHeader
            file={{
                title: doc.title,
                displayType,
                workspaceName: doc.workspaceName,
                updatedAt: doc.updatedAt,
                downloadUrl: doc.downloadUrl,
                markdownUrl: doc.markdownUrl,
            }}
        />
    );

    if (isTextOnlyType(displayType)) {
        return (
            <div className="bg-surface text-ink flex min-h-dvh flex-col">
                {header}
                <main className="flex min-h-0 flex-1 flex-col">
                    <PublicNoPreview
                        displayType={displayType}
                        text={text}
                        markdownUrl={doc.markdownUrl}
                        downloadUrl={doc.downloadUrl}
                    />
                </main>
                <PublicFooter />
            </div>
        );
    }

    return (
        <div className="bg-surface text-ink">
            <div className="flex h-dvh flex-col">
                {header}
                <main className="relative min-h-0 flex-1">
                    <PublicFileViewer
                        file={{
                            title: doc.title,
                            displayType,
                            mimeType: doc.mimeType,
                            ocrMetadata: doc.ocrMetadata,
                            contentUrl: doc.contentUrl,
                            apiBase: doc.apiBase,
                            allowDownload: doc.allowDownload,
                        }}
                    />
                </main>
            </div>
            <PublicTextSection
                // A CSV shown as a table: its text version keeps its rows.
                text={displayType === doc.displayType ? text : asCodeBlock(text, "csv")}
                markdownUrl={doc.markdownUrl}
            />
            <PublicFooter />
        </div>
    );
}

/** The brand, small and unlinked: no way into an app the visitor has no account for. */
function PublicFooter() {
    return (
        <footer className="border-line text-ink-3 flex items-center justify-center gap-2 border-t px-4 py-4 text-xs">
            <LaunchstackMark size={16} title="Launchstack" />
            <span>Launchstack</span>
        </footer>
    );
}
