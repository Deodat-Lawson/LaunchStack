"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import {
    externalLinkHost,
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
    notion: "openNotion",
    gmail: "openGmail",
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
        case "notion":
            return t("placeNotion");
        case "gmail":
            return t("placeGmail");
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
