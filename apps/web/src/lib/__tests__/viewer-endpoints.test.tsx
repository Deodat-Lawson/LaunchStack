/** @jest-environment jsdom */

import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import {
    PublicViewerEndpointsProvider,
    WORKSPACE_VIEWER_ENDPOINTS,
    publicViewerEndpoints,
    useViewerEndpoints,
    type ViewerEndpoints,
} from "~/lib/viewer-endpoints";

/**
 * Where a viewer reads its data: the session's own id-keyed routes by default,
 * and only the routes under a public link's token inside the public provider,
 * which also turns off everything that needs a session or spends money.
 */

const API_BASE = "/api/s/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";

function urls(endpoints: ViewerEndpoints) {
    return {
        trackView: endpoints.trackView,
        media: endpoints.media(12),
        transcriptText: endpoints.transcriptText(13),
        transcriptTranslations: endpoints.transcriptTranslations(13),
        websitePreview: endpoints.websitePreview(12),
        websiteText: endpoints.websiteText(12),
        mindmap: endpoints.mindmap(44),
    };
}

describe("viewer endpoints", () => {
    it("defaults to the workspace's own routes, keyed by id", () => {
        expect(WORKSPACE_VIEWER_ENDPOINTS.isPublic).toBe(false);
        expect(WORKSPACE_VIEWER_ENDPOINTS.allowDownload).toBe(true);
        expect(urls(WORKSPACE_VIEWER_ENDPOINTS)).toEqual({
            trackView: "/api/documents/track-view",
            media: "/api/documents/12/media",
            transcriptText: "/api/documents/13/content",
            transcriptTranslations: "/api/documents/13/transcript/translations",
            websitePreview: "/api/documents/12/website-preview",
            websiteText: "/api/documents/12/text?format=markdown",
            mindmap: "/api/mindmaps/44",
        });
    });

    it("maps a public link to the routes under its token and never names an id", () => {
        const endpoints = publicViewerEndpoints(API_BASE);
        expect(endpoints.isPublic).toBe(true);
        expect(endpoints.allowDownload).toBe(false);
        const all = urls(endpoints);
        expect(all).toEqual({
            trackView: null,
            media: `${API_BASE}/media`,
            transcriptText: `${API_BASE}/media/transcript`,
            transcriptTranslations: null,
            websitePreview: `${API_BASE}/website-preview`,
            websiteText: `${API_BASE}/text`,
            mindmap: `${API_BASE}/mindmap`,
        });
        for (const url of Object.values(all)) {
            if (url === null) continue;
            expect(url.startsWith(`${API_BASE}/`)).toBe(true);
            expect(url).not.toMatch(/\b(12|13|44)\b/);
        }
    });

    it("offers downloads only when the link allows them", () => {
        expect(publicViewerEndpoints(API_BASE, { allowDownload: true }).allowDownload).toBe(true);
        expect(publicViewerEndpoints(API_BASE, { allowDownload: false }).allowDownload).toBe(false);
    });

    it("tolerates a trailing slash on the base", () => {
        expect(publicViewerEndpoints(`${API_BASE}/`).media(1)).toBe(`${API_BASE}/media`);
    });

    function Probe() {
        const endpoints = useViewerEndpoints();
        return (
            <p data-testid="probe">
                {String(endpoints.isPublic)} {endpoints.media(5)} {String(endpoints.trackView)}
            </p>
        );
    }

    it("is the workspace without a provider", () => {
        render(<Probe />);
        expect(screen.getByTestId("probe")).toHaveTextContent(
            "false /api/documents/5/media /api/documents/track-view"
        );
    });

    it("is the public link inside the public provider", () => {
        render(
            <PublicViewerEndpointsProvider apiBase={API_BASE}>
                <Probe />
            </PublicViewerEndpointsProvider>
        );
        expect(screen.getByTestId("probe")).toHaveTextContent(`true ${API_BASE}/media null`);
    });
});
