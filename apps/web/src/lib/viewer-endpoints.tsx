"use client";

/**
 * Where a document viewer reads its data.
 *
 * Inside a workspace the viewers call the session's own routes, keyed by
 * document id (`/api/documents/:id/media`, `/api/mindmaps/:id`, …). A public
 * link (ADR-016) has no session and must never reveal an id: everything it
 * shows comes from the routes under its token (`/api/s/<token>/…`), which
 * work the ids out again on the server.
 *
 * The default is the workspace, so a viewer rendered without a provider
 * behaves exactly as it always has. The public page wraps its viewer in
 * `PublicViewerEndpointsProvider`, which also turns off everything that needs
 * a session or spends the workspace's money: recording a view, translating a
 * transcript (a model call), and the Word editor (it writes back). A viewer's
 * own Download buttons follow the link's download setting.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";

export interface ViewerEndpoints {
    /** A public link: no session, nothing that writes, nothing that spends. */
    isPublic: boolean;
    /** Whether a viewer may offer its own Download button. */
    allowDownload: boolean;
    /** POST `{ documentId }` to record a view, or null to record nothing. */
    trackView: string | null;
    /** GET the recording and transcript to show for an audio or video source (`MediaPreview`). */
    media(documentId: number): string;
    /** GET a plain transcript's text. */
    transcriptText(transcriptDocumentId: number): string;
    /** POST `{ language }` for a transcript's translation, or null when translating is off. */
    transcriptTranslations(transcriptDocumentId: number): string | null;
    /** GET the stored picture of a saved web page. */
    websitePreview(documentId: number): string;
    /** GET a saved web page's text as `{ markdown }`. */
    websiteText(documentId: number): string;
    /** GET `{ mindmap }`, the map behind a published mindmap document. */
    mindmap(mindmapId: number): string;
}

/** The session's own routes: what every viewer used before this existed. */
export const WORKSPACE_VIEWER_ENDPOINTS: ViewerEndpoints = Object.freeze({
    isPublic: false,
    allowDownload: true,
    trackView: "/api/documents/track-view",
    media: (id: number) => `/api/documents/${id}/media`,
    transcriptText: (id: number) => `/api/documents/${id}/content`,
    transcriptTranslations: (id: number) => `/api/documents/${id}/transcript/translations`,
    websitePreview: (id: number) => `/api/documents/${id}/website-preview`,
    websiteText: (id: number) => `/api/documents/${id}/text?format=markdown`,
    mindmap: (id: number) => `/api/mindmaps/${id}`,
});

/**
 * A public link's routes, all under `apiBase` (`/api/s/<token>`). The ids a
 * viewer passes are ignored: the token names the one file, and the server
 * pairs a recording with its transcript itself. Downloads are off unless the
 * link allows them.
 */
export function publicViewerEndpoints(
    apiBase: string,
    { allowDownload = false }: { allowDownload?: boolean } = {}
): ViewerEndpoints {
    const base = apiBase.replace(/\/+$/, "");
    return Object.freeze({
        isPublic: true,
        allowDownload,
        trackView: null,
        media: () => `${base}/media`,
        transcriptText: () => `${base}/media/transcript`,
        transcriptTranslations: () => null,
        websitePreview: () => `${base}/website-preview`,
        websiteText: () => `${base}/text`,
        mindmap: () => `${base}/mindmap`,
    });
}

const ViewerEndpointsContext = createContext<ViewerEndpoints>(WORKSPACE_VIEWER_ENDPOINTS);

export function useViewerEndpoints(): ViewerEndpoints {
    return useContext(ViewerEndpointsContext);
}

/** Viewers under this read the public link at `apiBase` and nothing else. */
export function PublicViewerEndpointsProvider({
    apiBase,
    allowDownload = false,
    children,
}: {
    apiBase: string;
    /** The link's own setting; off unless it says so. */
    allowDownload?: boolean;
    children: ReactNode;
}) {
    const value = useMemo(
        () => publicViewerEndpoints(apiBase, { allowDownload }),
        [apiBase, allowDownload]
    );
    return (
        <ViewerEndpointsContext.Provider value={value}>{children}</ViewerEndpointsContext.Provider>
    );
}
