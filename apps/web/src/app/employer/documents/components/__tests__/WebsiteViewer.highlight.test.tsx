/** @jest-environment jsdom */

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

import type { ViewerHighlight } from "~/lib/find-text-range";

import { WebsiteViewer } from "../WebsiteViewer";
import type { DocumentType } from "../../types/document";

/**
 * A citation must reach the text viewer only once its pane is visible. The
 * viewer locates and scrolls to the passage when the highlight changes and
 * never again, so a highlight that arrived while the pane was hidden (the
 * page text loaded earlier, then the reader went back to the preview) left
 * the passage unmarked after the pane was revealed.
 */

const mockSeen: Array<{ text: string; hidden: boolean }> = [];

jest.mock("../MarkdownViewer", () => {
    const { useEffect, useRef } = jest.requireActual<typeof import("react")>("react");
    return {
        MarkdownViewer: ({ highlight }: { highlight: ViewerHighlight | null }) => {
            const ref = useRef<HTMLDivElement>(null);
            useEffect(() => {
                if (highlight) {
                    mockSeen.push({
                        text: highlight.text,
                        hidden: Boolean(ref.current?.closest("[hidden]")),
                    });
                }
            }, [highlight]);
            return <div ref={ref}>indexed page text</div>;
        },
    };
});

const PAGE_TEXT =
    "Acme builds reusable rockets for small satellite teams. Launch windows open every week, and pricing starts low enough for a seed-stage company to fly. Free to start.";

beforeAll(() => {
    URL.createObjectURL = jest.fn(() => "blob:acme-preview");
    URL.revokeObjectURL = jest.fn();
    global.fetch = jest.fn((url: string) =>
        Promise.resolve({
            ok: true,
            status: 200,
            statusText: "",
            headers: { get: () => null },
            json: () =>
                Promise.resolve(
                    url.includes("/text") ? { markdown: PAGE_TEXT, chunkCount: 1 } : {}
                ),
            blob: () => Promise.resolve(new Blob(["webp"], { type: "image/webp" })),
        } as unknown as Response)
    ) as unknown as typeof fetch;
});

const site: DocumentType = {
    id: 7,
    title: "Acme",
    category: "Company",
    url: "/api/files/7",
    mimeType: "text/html",
    createdAt: "2026-10-17T12:00:00.000Z",
    ocrProcessed: true,
    ocrMetadata: { kind: "website", url: "https://www.acme.com/" },
};

const radio = (name: RegExp) => screen.getByRole("radio", { name });

it("hands a new citation to the page text only once that pane is showing", async () => {
    const { rerender } = render(<WebsiteViewer document={site} highlight={null} />);
    await screen.findByRole("img", { name: /as it looked when it was saved/ });

    // Read the page text once, then go back to the picture.
    fireEvent.click(radio(/page text/i));
    await screen.findByText("indexed page text");
    fireEvent.click(radio(/preview/i));
    expect(screen.getByText("indexed page text").closest("[hidden]")).not.toBeNull();

    // Now a citation arrives for this site.
    rerender(<WebsiteViewer document={site} highlight={{ text: "Free to start.", nonce: 2 }} />);

    await waitFor(() => expect(mockSeen).toHaveLength(1));
    expect(mockSeen[0]).toEqual({ text: "Free to start.", hidden: false });
    expect(radio(/page text/i)).toHaveAttribute("aria-checked", "true");
});
