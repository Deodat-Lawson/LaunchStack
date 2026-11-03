/** @jest-environment jsdom */

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

/**
 * The deck viewer over a stand-in for the PDF viewer: what matters here is
 * which URL it asks the server for, how it reports the server's refusals, and
 * what it hands the PDF viewer once the slides are rendered.
 */

interface StubProps {
    url: string;
    unit?: string;
    downloadUrl?: string;
    downloadName?: string;
    onCreateAnchoredNote?: unknown;
}
let lastViewerProps: StubProps | undefined;

jest.mock("~/components/notes/PdfViewerWithNotes", () => ({
    PdfViewerWithNotes: (props: StubProps) => {
        lastViewerProps = props;
        return <div data-testid="pdf-viewer">{props.url}</div>;
    },
}));

// `next/dynamic` resolves the loader on a microtask; the stub is enough here.
jest.mock("next/dynamic", () => ({
    __esModule: true,
    default: () =>
        jest.requireMock<{ PdfViewerWithNotes: React.ComponentType<StubProps> }>(
            "~/components/notes/PdfViewerWithNotes"
        ).PdfViewerWithNotes,
}));

import { PptxViewer, deckPreviewUrl } from "../PptxViewer";

const fetchMock = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>();

/** jsdom has no `Response`; these are the two shapes the viewer reads. */
function renderedPdf(): Response {
    return {
        ok: true,
        status: 200,
        blob: () => Promise.resolve(new Blob(["%PDF"])),
    } as unknown as Response;
}
function refusal(status: number, body?: object): Response {
    return {
        ok: false,
        status,
        json: () => (body ? Promise.resolve(body) : Promise.reject(new SyntaxError("not JSON"))),
    } as unknown as Response;
}
const createObjectURL = jest.fn(() => "blob:deck-1");
const revokeObjectURL = jest.fn();

beforeAll(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
});

beforeEach(() => {
    jest.clearAllMocks();
    lastViewerProps = undefined;
});

function renderDeck() {
    return render(
        <PptxViewer documentId={7} url="https://files.example/pitch.pptx" title="Pitch.pptx" />
    );
}

describe("PptxViewer", () => {
    it("asks the server for the rendered PDF and shows it counted in slides", async () => {
        fetchMock.mockResolvedValue(renderedPdf());
        renderDeck();

        expect(screen.getByRole("status")).toHaveTextContent("Rendering slides…");
        expect(fetchMock).toHaveBeenCalledWith(
            deckPreviewUrl(7),
            expect.objectContaining({ signal: expect.any(AbortSignal) })
        );

        await screen.findByTestId("pdf-viewer");
        expect(lastViewerProps).toMatchObject({
            url: "blob:deck-1",
            unit: "slide",
            downloadUrl: "https://files.example/pitch.pptx",
            downloadName: "Pitch.pptx",
        });
        // Read-only: nothing to hand a selection to.
        expect(lastViewerProps?.onCreateAnchoredNote).toBeUndefined();
    });

    it("shows the server's reason when it refuses, with Download and Retry", async () => {
        fetchMock
            .mockResolvedValueOnce(
                refusal(503, {
                    success: false,
                    error: "service_not_configured",
                    message: "The PDF rendering service is not configured.",
                })
            )
            .mockResolvedValueOnce(renderedPdf());
        renderDeck();

        const notice = await screen.findByRole("alert");
        expect(notice).toHaveTextContent("Couldn’t render this presentation");
        expect(notice).toHaveTextContent("The PDF rendering service is not configured.");
        expect(screen.getByRole("link", { name: /Download presentation/ })).toHaveAttribute(
            "href",
            "https://files.example/pitch.pptx"
        );

        fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
        await screen.findByTestId("pdf-viewer");
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("falls back to the status when a failure carries no message", async () => {
        fetchMock.mockResolvedValue(refusal(502));
        renderDeck();
        const notice = await screen.findByRole("alert");
        expect(notice).toHaveTextContent("HTTP 502");
    });

    it("releases the rendered bytes when it unmounts", async () => {
        fetchMock.mockResolvedValue(renderedPdf());
        const { unmount } = renderDeck();
        await screen.findByTestId("pdf-viewer");
        unmount();
        await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:deck-1"));
    });
});
