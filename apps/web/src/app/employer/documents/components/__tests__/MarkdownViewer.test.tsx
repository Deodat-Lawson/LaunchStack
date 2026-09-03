/** @jest-environment jsdom */

import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { MarkdownViewer } from "../MarkdownViewer";
import { getDocumentDisplayType } from "../../types/document";

/**
 * Uploaded .md files render as documents, not as raw source in an iframe.
 * These tests pin the whole path: classification routes markdown to the
 * viewer, and the viewer actually renders GFM — headings, tables, task
 * lists — with an outline and a way back to the source.
 */

const SAMPLE = `# Quarterly Plan

Intro paragraph with [a link](https://example.com) and \`inline code\`.

## Goals

- [x] Ship the connector
- [ ] Write the docs

## Numbers

| Metric | Target |
| ------ | ------ |
| ARR    | $1M    |

\`\`\`ts
const x = 1;
\`\`\`
`;

const fetchMock = jest.fn();

beforeAll(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
});

beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(SAMPLE),
    } as unknown as Response);
});

describe("markdown display type classification", () => {
    it("routes markdown mime types to the markdown viewer", () => {
        expect(
            getDocumentDisplayType({ url: "u", title: "notes", mimeType: "text/markdown" })
        ).toBe("markdown");
        expect(
            getDocumentDisplayType({ url: "u", title: "notes", mimeType: "text/x-markdown" })
        ).toBe("markdown");
    });

    it("routes .md and .markdown extensions to the markdown viewer when mime is missing", () => {
        expect(getDocumentDisplayType({ url: "https://x/store/abc", title: "README.md" })).toBe(
            "markdown"
        );
        expect(getDocumentDisplayType({ url: "https://x/notes.markdown", title: "notes" })).toBe(
            "markdown"
        );
    });

    it("leaves plain text and code files alone", () => {
        expect(getDocumentDisplayType({ url: "u", title: "notes.txt" })).toBe("text");
        expect(getDocumentDisplayType({ url: "u", title: "script.py" })).toBe("code");
    });
});

describe("MarkdownViewer", () => {
    it("renders the document as formatted markdown", async () => {
        render(<MarkdownViewer url="https://x/doc.md" title="doc.md" />);

        expect(
            await screen.findByRole("heading", { level: 1, name: "Quarterly Plan" })
        ).toBeInTheDocument();
        expect(screen.getByRole("heading", { level: 2, name: "Goals" })).toBeInTheDocument();

        // GFM table
        expect(screen.getByRole("table")).toBeInTheDocument();
        expect(screen.getByText("ARR")).toBeInTheDocument();

        // GFM task list
        const checkboxes = screen.getAllByRole("checkbox");
        expect(checkboxes).toHaveLength(2);
        expect(checkboxes[0]).toBeChecked();
        expect(checkboxes[1]).not.toBeChecked();

        // External links open in a new tab
        const link = screen.getByRole("link", { name: "a link" });
        expect(link).toHaveAttribute("target", "_blank");
        expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    });

    it("shows an outline built from the headings", async () => {
        render(<MarkdownViewer url="https://x/doc.md" title="doc.md" />);
        await screen.findByRole("heading", { level: 1, name: "Quarterly Plan" });

        const outline = await screen.findByRole("navigation", { name: "Document outline" });
        expect(within(outline).getByText("Quarterly Plan")).toBeInTheDocument();
        expect(within(outline).getByText("Goals")).toBeInTheDocument();
        expect(within(outline).getByText("Numbers")).toBeInTheDocument();

        // Headings got GitHub-style anchor ids
        expect(screen.getByRole("heading", { level: 2, name: "Goals" }).getAttribute("id")).toBe(
            "goals"
        );
    });

    it("shows document stats in the toolbar", async () => {
        render(<MarkdownViewer url="https://x/doc.md" title="doc.md" />);
        await screen.findByRole("heading", { level: 1, name: "Quarterly Plan" });
        expect(screen.getByText(/words/)).toBeInTheDocument();
        expect(screen.getByText(/min read/)).toBeInTheDocument();
    });

    it("can switch to the raw source view", async () => {
        const user = userEvent.setup();
        render(<MarkdownViewer url="https://x/doc.md" title="doc.md" />);
        await screen.findByRole("heading", { level: 1, name: "Quarterly Plan" });

        await user.click(screen.getByRole("button", { name: "View source" }));

        // Rendered headings are gone; the raw markdown is on screen instead.
        await waitFor(() => {
            expect(
                screen.queryByRole("heading", { level: 1, name: "Quarterly Plan" })
            ).not.toBeInTheDocument();
        });
        await waitFor(() => {
            expect(document.body.textContent).toContain("# Quarterly Plan");
        });
    });

    it("surfaces fetch failures with a retry", async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 500,
            statusText: "Server Error",
        } as unknown as Response);
        render(<MarkdownViewer url="https://x/doc.md" title="doc.md" />);
        expect(await screen.findByText("Failed to load document")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    });
});
