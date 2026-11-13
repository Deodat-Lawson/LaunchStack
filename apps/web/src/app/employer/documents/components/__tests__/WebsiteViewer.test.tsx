/** @jest-environment jsdom */

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { WebsiteViewer } from "../WebsiteViewer";
import type { DocumentType } from "../../types/document";

/**
 * A saved web page opens as a picture of the page as it was saved, never as
 * its HTML in a frame (framed, most company sites were a white page) and not
 * as its text. The text ingestion read stays one click away, and is where a
 * citation lands.
 */

const PAGE_TEXT = `# Acme

![](https://acme.com/hero-glow.png)
![Our launch pad at dawn](https://acme.com/pad.jpg)

Acme builds reusable rockets for small satellite teams. Launch windows open every week, and pricing starts low enough for a seed-stage company to fly.

## Pricing

Free to start.`;

const PREVIEW = "/api/documents/7/website-preview";
const TEXT = "/api/documents/7/text?format=markdown";

interface Reply {
    ok: boolean;
    status?: number;
    json?: unknown;
    headers?: Record<string, string>;
}

const fetchMock = jest.fn();
let replies: Record<string, Reply[]> = {};

function reply(url: string, ...answers: Reply[]) {
    replies[url] = answers;
}

beforeAll(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
    URL.createObjectURL = jest.fn(() => "blob:acme-preview");
    URL.revokeObjectURL = jest.fn();
});

beforeEach(() => {
    replies = {};
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) => {
        const queue = replies[url];
        const answer = (queue && queue.length > 1 ? queue.shift() : queue?.[0]) ?? {
            ok: false,
            status: 404,
            json: {},
        };
        const headers = new Map(
            Object.entries(answer.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])
        );
        return Promise.resolve({
            ok: answer.ok,
            status: answer.status ?? 200,
            statusText: "",
            headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
            json: () => Promise.resolve(answer.json ?? {}),
            blob: () => Promise.resolve(new Blob(["webp"], { type: "image/webp" })),
        } as unknown as Response);
    });
});

const picture = (truncated = false): Reply => ({
    ok: true,
    headers: { "Content-Type": "image/webp", "X-Preview-Truncated": String(truncated) },
});

const pageText = (markdown: string, chunkCount: number): Reply => ({
    ok: true,
    json: { markdown, chunkCount, documentId: 7 },
});

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

function openPageText() {
    fireEvent.click(screen.getByRole("radio", { name: /page text/i }));
}

describe("WebsiteViewer", () => {
    it("opens on a picture of the page, with the site's address and a link to it", async () => {
        reply(PREVIEW, picture());
        const { container } = render(<WebsiteViewer document={site()} />);

        expect(screen.getByText("acme.com")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /open site/i })).toHaveAttribute(
            "href",
            "https://www.acme.com/"
        );
        expect(screen.getByText(/taking a picture of the page/i)).toBeInTheDocument();

        const shot = await screen.findByRole("img", {
            name: "acme.com as it looked when it was saved",
        });
        expect(shot).toHaveAttribute("src", "blob:acme-preview");
        expect(screen.getByRole("radio", { name: /preview/i })).toHaveAttribute(
            "aria-checked",
            "true"
        );
        // Neither framed HTML nor the indexed text is the preview.
        expect(container.querySelector("iframe")).toBeNull();
        expect(fetchMock).toHaveBeenCalledWith(PREVIEW);
        expect(fetchMock).not.toHaveBeenCalledWith(TEXT);
        expect(screen.queryByText(/stops here/i)).toBeNull();
    });

    it("says where the picture stops on a page too long to keep whole", async () => {
        reply(PREVIEW, picture(true));
        render(<WebsiteViewer document={site()} />);

        expect(await screen.findByText(/the picture stops here/i)).toBeInTheDocument();
    });

    it("shows the text read from the page under Page text, without decorative images", async () => {
        reply(PREVIEW, picture());
        reply(TEXT, pageText(PAGE_TEXT, 2));
        const { container } = render(<WebsiteViewer document={site()} />);
        await screen.findByRole("img", { name: /as it looked when it was saved/ });

        openPageText();

        expect(
            await screen.findByRole("heading", { level: 2, name: "Pricing" })
        ).toBeInTheDocument();
        expect(screen.getByText(/text LaunchStack read from this page/)).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledWith(TEXT);
        // The picture stays loaded (hidden) for switching back; the text keeps
        // only images that describe something.
        const textImages = Array.from(container.querySelectorAll(".md-doc img")).map(
            img => (img as HTMLImageElement).alt
        );
        expect(textImages).toEqual(["Our launch pad at dawn"]);

        fireEvent.click(screen.getByRole("radio", { name: /preview/i }));
        expect(screen.getByRole("img", { name: /as it looked when it was saved/ })).toBeVisible();
        expect(fetchMock.mock.calls.filter(([u]) => u === PREVIEW)).toHaveLength(1);
    });

    it("opens a citation on the page text, where its passage can be highlighted", async () => {
        // jsdom lays nothing out; give the located range a box to draw.
        Range.prototype.getClientRects = () =>
            [{ top: 10, left: 4, width: 120, height: 18 }] as unknown as DOMRectList;
        reply(TEXT, pageText(PAGE_TEXT, 2));
        render(
            <WebsiteViewer document={site()} highlight={{ text: "Free to start.", nonce: 1 }} />
        );

        expect(
            await screen.findByRole("heading", { level: 2, name: "Pricing" })
        ).toBeInTheDocument();
        expect(screen.getByRole("radio", { name: /page text/i })).toHaveAttribute(
            "aria-checked",
            "true"
        );
        expect(fetchMock).not.toHaveBeenCalledWith(PREVIEW);
    });

    it("explains a server that can't take pictures, and offers the page text", async () => {
        reply(PREVIEW, {
            ok: false,
            status: 503,
            json: {
                error: "service_not_configured",
                message: "Page previews need the rendering service.",
            },
        });
        reply(TEXT, pageText(PAGE_TEXT, 2));
        render(<WebsiteViewer document={site()} />);

        expect(await screen.findByText("Page previews aren't set up here")).toBeInTheDocument();
        expect(screen.getByText("Page previews need the rendering service.")).toBeInTheDocument();
        // Trying again can't help without the service.
        expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: /read the page text/i }));
        expect(
            await screen.findByRole("heading", { level: 2, name: "Pricing" })
        ).toBeInTheDocument();
    });

    it("offers to try again when taking the picture failed", async () => {
        reply(
            PREVIEW,
            {
                ok: false,
                status: 502,
                json: {
                    error: "rendering_failed",
                    message: "The rendering service couldn't take a picture of this page.",
                },
            },
            picture()
        );
        render(<WebsiteViewer document={site()} />);

        expect(await screen.findByText("Couldn't show this page")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: /try again/i }));

        expect(
            await screen.findByRole("img", { name: /as it looked when it was saved/ })
        ).toBeInTheDocument();
        expect(fetchMock.mock.calls.filter(([u]) => u === PREVIEW)).toHaveLength(2);
    });

    it("says a page built with JavaScript had nothing to read, instead of a blank page", async () => {
        reply(PREVIEW, picture());
        reply(TEXT, pageText("You need to enable JavaScript to run this app.", 1));
        render(<WebsiteViewer document={site()} />);
        openPageText();

        expect(await screen.findByText(/almost no text on this page/i)).toBeInTheDocument();
        expect(screen.queryByText(/text LaunchStack read from this page/)).toBeNull();
    });

    it("says the page is still being read while ingestion runs", async () => {
        reply(PREVIEW, picture());
        reply(TEXT, pageText("", 0));
        render(<WebsiteViewer document={site({ ocrProcessed: false })} />);
        openPageText();

        expect(await screen.findByText("Still reading this page")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /check again/i })).toBeInTheDocument();
    });

    it("shows why ingestion could not read the page", async () => {
        reply(PREVIEW, picture());
        reply(TEXT, pageText("", 0));
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
        openPageText();

        expect(await screen.findByText("This page couldn't be read")).toBeInTheDocument();
        expect(screen.getByText(/Conversion failed/)).toBeInTheDocument();
    });
});
