/** @jest-environment jsdom */

import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { DocumentViewer } from "../DocumentViewer";
import type { DocumentType } from "../../types";

/**
 * An uploaded or crawled web page is untrusted code. The viewer frames it in a
 * sandbox with neither `allow-same-origin` nor `allow-scripts`, so it renders
 * in an opaque origin and nothing in it runs; the file route's `sandbox` CSP
 * is the second lock. PDFs are the exception: Chrome will not open its PDF
 * viewer inside a sandbox.
 */

const fetchMock = jest.fn();

beforeAll(() => {
    // The viewer records a view on mount.
    global.fetch = fetchMock as unknown as typeof fetch;
});

beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true } as Response);
});

function frameFor(overrides: Partial<DocumentType>): HTMLElement {
    const doc: DocumentType = {
        id: 7,
        title: "page.html",
        category: "General",
        url: "/api/files/7",
        ...overrides,
    };
    render(<DocumentViewer document={doc} />);
    const frame = screen.getByTitle(doc.title);
    expect(frame.tagName).toBe("IFRAME");
    return frame;
}

function expectSandboxed(frame: HTMLElement) {
    expect(frame).toHaveAttribute("sandbox");
    const tokens = (frame.getAttribute("sandbox") ?? "").split(/\s+/);
    expect(tokens).not.toContain("allow-same-origin");
    expect(tokens).not.toContain("allow-scripts");
}

describe("DocumentViewer framing", () => {
    it("frames an HTML document sandboxed, with no same origin and no scripts", () => {
        const frame = frameFor({ mimeType: "text/html" });

        expectSandboxed(frame);
        expect(frame).toHaveAttribute("src", "/api/files/7");
    });

    it("sandboxes an HTML document known only by its extension", () => {
        expectSandboxed(frameFor({ title: "saved-page.htm" }));
    });

    it("sandboxes a type it cannot classify, such as XHTML", () => {
        expectSandboxed(frameFor({ title: "page.xhtml", mimeType: "application/xhtml+xml" }));
    });

    it("frames a PDF without a sandbox so the browser's viewer can open it", () => {
        const frame = frameFor({ title: "report.pdf", mimeType: "application/pdf" });

        expect(frame).not.toHaveAttribute("sandbox");
        expect(frame).toHaveAttribute("src", "/api/files/7#page=1");
    });
});
