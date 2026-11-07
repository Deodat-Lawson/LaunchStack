import type { BugSeverity, FeedbackKind } from "~/lib/feedback/contract";

export interface FeedbackImage {
    id: string;
    blob: Blob;
    /** An object URL for the preview; revoked when the image is dropped. */
    url: string;
}

/** What has been typed so far. Kept by the provider, so closing the dialog by accident loses nothing. */
export interface FeedbackDraft {
    kind: FeedbackKind;
    title: string;
    body: string;
    severity: BugSeverity | null;
    images: FeedbackImage[];
    /** Send the technical details (page, browser, recent errors). Bugs default on, ideas off. */
    technical: boolean;
    /** What prefilled it: an error screen's digest, a failed source's job id. */
    origin?: Record<string, string>;
}

export function emptyDraft(kind: FeedbackKind = "bug"): FeedbackDraft {
    return { kind, title: "", body: "", severity: null, images: [], technical: kind === "bug" };
}

/** The `origin` keys the dialog names; any other key is shown as is. */
export const ORIGIN_KEYS = ["errorId", "message", "jobId", "document", "problem"] as const;
export type OriginKey = (typeof ORIGIN_KEYS)[number];

export function isOriginKey(key: string): key is OriginKey {
    return (ORIGIN_KEYS as readonly string[]).includes(key);
}
