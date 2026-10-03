/** @jest-environment jsdom */

import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { WebsiteViewer } from "../WebsiteViewer";
import type { DocumentType } from "../../types/document";

/**
 * A saved web page opens as the site it is (its address, a way to open it)
 * and the text ingestion read from it, never as its HTML in a frame: framed
 * with scripts off, most company sites were a white page.
 */

const PAGE_TEXT = `# Acme

![](https://acme.com/hero-glow.png)
![Our launch pad at dawn](https://acme.com/pad.jpg)

Acme builds reusable rockets for small satellite teams. Launch windows open every week, and pricing starts low enough for a seed-stage company to fly.

## Pricing

Free to start.`;

const fetchMock = jest.fn();

beforeAll(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
});

beforeEach(() => {
    fetchMock.mockReset();
});

function respondWith(body: { markdown: string; chunkCount: number }) {
    fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ...body, documentId: 7 }),
    } as unknown as Response);
}

function site(overrides: Partial<DocumentType> = {}): DocumentType {
    return {
        id: 7,
        title: "Acme — Reusable rockets",
        category: "Company",
        url: "/api/files/7",
        mimeType: "text/html",
        createdAt: "2026-10-17T12:00:00.000Z",
        ocrProcessed: true,
        ocrMetadata: {
            kind: "website",
            url: "https://www.acme.com/",
            capturedAt: "2026-10-17T12:00:00.000Z",
        },
        ...overrides,
    };
}

describe("WebsiteViewer", () => {
    it("shows the site's address, a link to it, and the text read from it", async () => {
        respondWith({ markdown: PAGE_TEXT, chunkCount: 2 });
        const { container } = render(<WebsiteViewer document={site()} />);

        expect(screen.getByText("acme.com")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /open site/i })).toHaveAttribute(
            "href",
            "https://www.acme.com/"
        );
        expect(
            await screen.findByRole("heading", { level: 2, name: "Pricing" })
        ).toBeInTheDocument();
        expect(screen.getByText(/text LaunchStack read from this page/)).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledWith("/api/documents/7/text?format=markdown");
        // Decorative images (no alt text) are left out; described ones stay.
        const images = Array.from(container.querySelectorAll("img")).map(img => img.alt);
        expect(images).toEqual(["Our launch pad at dawn"]);
        // The stored HTML is never framed.
        expect(container.querySelector("iframe")).toBeNull();
    });

    it("says a page built with JavaScript had nothing to read, instead of a blank page", async () => {
        respondWith({ markdown: "You need to enable JavaScript to run this app.", chunkCount: 1 });
        render(<WebsiteViewer document={site()} />);

        expect(await screen.findByText(/almost no text on this page/i)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /open site/i })).toBeInTheDocument();
        expect(screen.queryByText(/text LaunchStack read from this page/)).toBeNull();
    });

    it("says the page is still being read while ingestion runs", async () => {
        respondWith({ markdown: "", chunkCount: 0 });
        render(<WebsiteViewer document={site({ ocrProcessed: false })} />);

        expect(await screen.findByText("Still reading this page")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /check again/i })).toBeInTheDocument();
    });

    it("shows why ingestion could not read the page", async () => {
        respondWith({ markdown: "", chunkCount: 0 });
        render(
            <WebsiteViewer
                document={site({
                    ocrProcessed: false,
                    ocrMetadata: {
                        kind: "website",
                        url: "https://www.acme.com/",
                        error: "Conversion failed",
                    },
                })}
            />
        );

        expect(await screen.findByText("This page couldn't be read")).toBeInTheDocument();
        expect(screen.getByText(/Conversion failed/)).toBeInTheDocument();
    });
});
