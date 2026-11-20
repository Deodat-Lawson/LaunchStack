"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import {
    externalLinkHost,
    isSourceExternalLink,
    type ExternalLinkKind,
    type SourceExternalLink,
} from "~/lib/source-external-link";

/**
 * How a source's way out of LaunchStack is worded and followed — the viewer
 * header's button, its details row, and the row menus in the rail and the
 * Knowledge tab all say the same thing.
 */

export type ExternalLinkTranslator = ReturnType<typeof useTranslations<"sources.externalLink">>;

const OPEN_KEYS = {
    "google-drive": "openGoogleDrive",
    onedrive: "openOneDrive",
    sharepoint: "openSharePoint",
    notion: "openNotion",
    gmail: "openGmail",
    outlook: "openOutlook",
    obsidian: "openObsidian",
    github: "openGithub",
    youtube: "openYoutube",
    claude: "openClaude",
    web: "openWeb",
    file: "openFile",
} as const satisfies Record<ExternalLinkKind, string>;

/** "Open in Notion", "Open on GitHub", "Open file". */
export function externalLinkLabel(t: ExternalLinkTranslator, link: SourceExternalLink): string {
    return t(OPEN_KEYS[link.kind]);
}

/** The tooltip: which site it goes to, or that it is the file itself. */
export function externalLinkHint(t: ExternalLinkTranslator, link: SourceExternalLink): string {
    if (link.kind === "file") return t("hintFile");
    if (link.kind === "obsidian") return t("hintObsidian");
    const host = externalLinkHost(link);
    return host ? t("hintSite", { host }) : externalLinkLabel(t, link);
}

/** Where it opens, for the details row: "Notion", "github.com/acme/app", "Your browser". */
export function externalLinkPlace(t: ExternalLinkTranslator, link: SourceExternalLink): string {
    switch (link.kind) {
        case "google-drive":
            return t("placeGoogleDrive");
        case "onedrive":
            return t("placeOneDrive");
        case "sharepoint":
            return t("placeSharePoint");
        case "notion":
            return t("placeNotion");
        case "gmail":
            return t("placeGmail");
        case "outlook":
            return t("placeOutlook");
        case "obsidian":
            return t("placeObsidian");
        case "youtube":
            return t("placeYoutube");
        case "file":
            return t("placeFile");
        default:
            return externalLinkHost(link) ?? externalLinkLabel(t, link);
    }
}

/** Whether a link opens an app on this computer rather than a page in a tab. */
export function opensAnApp(link: SourceExternalLink): boolean {
    return link.kind === "obsidian";
}

/**
 * Follow it. A web address opens in a new tab, cut off from this one; an app
 * link (Obsidian) is handed to the browser in place, which asks to open the
 * app without leaving the page — a new tab would sit blank behind it.
 */
export function openExternalLink(link: SourceExternalLink): void {
    if (opensAnApp(link)) {
        window.location.assign(link.url);
        return;
    }
    window.open(link.url, "_blank", "noopener,noreferrer");
}

/**
 * Save the stored file rather than open it. Same-origin, so the browser
 * honours `download` and names the file from the route's Content-Disposition;
 * a file stored on another origin opens instead, as it always has.
 */
export function downloadStoredFile(url: string): void {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "";
    // Ignored by a download; a file on another origin opens in a tab rather
    // than replacing the workspace.
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
}

export interface OpenOutside {
    label: (link: SourceExternalLink) => string;
    open: (link: SourceExternalLink) => void;
}

/** What the menu builders need to offer "Open in …", worded in the reader's language. */
export function useOpenOutside(): OpenOutside {
    const t = useTranslations("sources.externalLink");
    return useMemo(
        () => ({ label: link => externalLinkLabel(t, link), open: openExternalLink }),
        [t]
    );
}

/**
 * What the viewer's Drive line knows about the document's Drive copy, as one
 * comparable value: null before it has loaded, "none" without a live copy,
 * "linked:<url>" with one. An orphaned copy (trashed in Drive) counts as none,
 * as it does on the server.
 */
export function driveLinkKey(
    status: { link: { status: string; url: string | null } | null } | null
): string | null {
    if (status === null) return null;
    return status.link?.status === "linked" ? `linked:${status.link.url ?? ""}` : "none";
}

/**
 * The outside link as the server words it after the document's Drive copy
 * was linked or unlinked while the viewer was open, or `undefined` until
 * that happens. The viewer reads the link once with the document; without
 * this, unlinking left "Open in Google Drive" pointing at a trashed copy,
 * and a new link kept offering "Open file", until the viewer was reopened.
 * Only the link is read again: the loaded document, and the preview made
 * from it, are left alone. A fresher load of the document (`loaded`
 * changing) supersedes the answer.
 */
export function useDriveChangedOutsideLink(
    documentId: number | null,
    driveKey: string | null,
    loaded: unknown
): SourceExternalLink | null | undefined {
    const [answer, setAnswer] = useState<{
        documentId: number;
        link: SourceExternalLink | null;
    } | null>(null);
    const last = useRef({ documentId, driveKey });

    useEffect(() => {
        setAnswer(null);
    }, [loaded, documentId]);

    useEffect(() => {
        const previous = last.current;
        last.current = { documentId, driveKey };
        // Only a change seen on this document, from one known state to
        // another: its first status arriving is not a change.
        if (documentId === null || driveKey === null) return;
        if (previous.documentId !== documentId || previous.driveKey === null) return;
        if (previous.driveKey === driveKey) return;

        let cancelled = false;
        void (async () => {
            try {
                const res = await fetch("/api/fetchDocument", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: "{}",
                });
                if (!res.ok) return;
                const rows = (await res.json()) as Array<{ id: number; externalLink?: unknown }>;
                if (cancelled) return;
                const link = rows.find(row => row.id === documentId)?.externalLink;
                setAnswer({ documentId, link: isSourceExternalLink(link) ? link : null });
            } catch {
                // Unreachable: the earlier link stands.
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [documentId, driveKey]);

    return answer && answer.documentId === documentId ? answer.link : undefined;
}
