/** @jest-environment jsdom */

import React, { type ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { pdfjs } from "react-pdf";
import PdfAttachmentPreview from "../PdfAttachmentPreview";
import { ChatAttachmentChip } from "../ChatAttachmentChip";

interface TestDocumentProps {
    file: { url: string };
    options: { isEvalSupported: boolean; enableXfa: boolean };
    children: ReactNode;
    loading: ReactNode;
    onLoadSuccess: (pdf: { numPages: number }) => void;
    onLoadError: () => void;
    onPassword: () => void;
}
interface TestPageProps {
    pageNumber: number;
    renderAnnotationLayer: boolean;
    renderTextLayer: boolean;
    width: number;
    onRenderError: () => void;
}
let mockDocument: TestDocumentProps | undefined;
let mockPage: TestPageProps | undefined;

jest.mock("react-pdf", () => ({
    pdfjs: { GlobalWorkerOptions: { workerSrc: "" } },
    Document: (props: TestDocumentProps) => {
        mockDocument = props;
        return <div>{props.children === false ? props.loading : props.children}</div>;
    },
    Page: (props: TestPageProps) => {
        mockPage = props;
        return <div data-testid="pdf-rendered-page">Rendered PDF page {props.pageNumber}</div>;
    },
}));
jest.mock("next/dynamic", () => ({
    __esModule: true,
    default: () =>
        jest.requireActual<{ default: typeof PdfAttachmentPreview }>("../PdfAttachmentPreview")
            .default,
}));

beforeEach(() => {
    mockDocument = undefined;
    mockPage = undefined;
});

describe("PDF attachment rendering", () => {
    it("uses the workspace PDF.js worker and renders selectable pages with navigation", () => {
        render(<PdfAttachmentPreview url="/uploaded.pdf" name="uploaded.pdf" />);
        expect(screen.getByRole("status")).toHaveTextContent("Loading PDF");
        expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe(
            process.env.NEXT_PUBLIC_PDF_WORKER_URL ?? "/pdf.worker.min.mjs"
        );
        expect(mockDocument?.file).toEqual({ url: "/uploaded.pdf" });
        expect(mockDocument?.options).toEqual({ isEvalSupported: false, enableXfa: false });
        act(() => mockDocument?.onLoadSuccess({ numPages: 2 }));
        expect(screen.getByTestId("pdf-rendered-page")).toHaveTextContent("Rendered PDF page 1");
        expect(mockPage).toEqual(
            expect.objectContaining({ renderAnnotationLayer: false, renderTextLayer: true })
        );
        expect(screen.getByRole("button", { name: "Previous PDF page" })).toBeDisabled();
        fireEvent.click(screen.getByRole("button", { name: "Next PDF page" }));
        expect(screen.getByTestId("pdf-rendered-page")).toHaveTextContent("Rendered PDF page 2");
        expect(screen.getByRole("button", { name: "Next PDF page" })).toBeDisabled();
    });

    it("resizes the PDF page to its bounded container when the viewport becomes narrow", () => {
        const originalObserver = global.ResizeObserver;
        let callback: ResizeObserverCallback | undefined;
        const observer: ResizeObserver = {
            observe: jest.fn(),
            unobserve: jest.fn(),
            disconnect: jest.fn(),
        };
        class PreviewResizeObserver implements ResizeObserver {
            constructor(onResize: ResizeObserverCallback) {
                callback = onResize;
            }
            observe = jest.fn();
            unobserve = jest.fn();
            disconnect = jest.fn();
        }
        global.ResizeObserver = PreviewResizeObserver;
        try {
            render(<PdfAttachmentPreview url="/uploaded.pdf" name="uploaded.pdf" />);
            const root = screen.getByLabelText("PDF preview uploaded.pdf").parentElement!;
            expect(root).toHaveClass("w-full", "min-w-0", "max-w-full", "overflow-hidden");
            const resize = (width: number) => {
                const entry: ResizeObserverEntry = {
                    target: root,
                    contentRect: {
                        x: 0,
                        y: 0,
                        width,
                        height: 300,
                        top: 0,
                        right: width,
                        bottom: 300,
                        left: 0,
                        toJSON: () => ({}),
                    },
                    borderBoxSize: [],
                    contentBoxSize: [],
                    devicePixelContentBoxSize: [],
                };
                act(() => callback?.([entry], observer));
            };
            resize(716);
            act(() => mockDocument?.onLoadSuccess({ numPages: 2 }));
            expect(mockPage?.width).toBe(700);
            resize(293);
            expect(mockPage?.width).toBe(277);
            expect(screen.getByRole("button", { name: "Next PDF page" })).toBeVisible();
            expect(screen.getByRole("spinbutton", { name: "PDF page" })).toBeVisible();
        } finally {
            global.ResizeObserver = originalObserver;
        }
    });

    it("keeps safe original/download fallbacks after a document or page failure instead of a blank iframe", () => {
        render(
            <ChatAttachmentChip
                attachment={{
                    id: "pdf",
                    name: "preview.pdf",
                    url: "/preview.pdf",
                    mimeType: "application/pdf",
                    size: 601,
                    kind: "text",
                }}
            />
        );
        fireEvent.click(screen.getByRole("button", { name: "Preview preview.pdf" }));
        expect(document.querySelector("iframe")).toBeNull();
        act(() => mockDocument?.onLoadError());
        expect(screen.getByRole("alert")).toHaveTextContent("Open the original or download");
        expect(screen.getByRole("link", { name: "Open original" })).toHaveAttribute(
            "href",
            "/preview.pdf"
        );
        expect(screen.getByRole("link", { name: "Download PDF" })).toHaveAttribute(
            "download",
            "preview.pdf"
        );
        fireEvent.click(screen.getByRole("button", { name: "Retry PDF preview" }));
        act(() => mockDocument?.onLoadSuccess({ numPages: 1 }));
        expect(screen.getByTestId("pdf-rendered-page")).toHaveTextContent("page 1");
        act(() => mockPage?.onRenderError());
        expect(screen.getByRole("alert")).toHaveTextContent("PDF preview could not load");
        expect(screen.getByRole("link", { name: "Open original" })).toBeInTheDocument();
    });

    it("shows an actionable password error and refuses unsafe PDF URL schemes", () => {
        const { rerender } = render(<PdfAttachmentPreview url="/locked.pdf" name="locked.pdf" />);
        act(() => mockDocument?.onPassword());
        expect(screen.getByRole("alert")).toHaveTextContent("requires a password");
        mockDocument = undefined;
        rerender(<PdfAttachmentPreview url="javascript:alert(1)" name="unsafe.pdf" />);
        expect(screen.getByRole("alert")).toHaveTextContent("URL is unavailable");
        expect(mockDocument).toBeUndefined();
        expect(document.querySelector("iframe")).toBeNull();
    });
});
