import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    GotenbergClient,
    createGotenbergClient,
    RenderingConfigError,
    RenderingServiceError,
} from "../client";
import { PAPER_SIZES } from "../types";

const mockFetch = vi.fn();

beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

function pdfResponse(headers: Record<string, string> = {}): Response {
    return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
        status: 200,
        headers: { "content-type": "application/pdf", ...headers },
    });
}

function client(overrides: Partial<ConstructorParameters<typeof GotenbergClient>[0]> = {}) {
    return createGotenbergClient({ baseUrl: "http://gotenberg:3000", ...overrides });
}

describe("construction", () => {
    it("requires a baseUrl", () => {
        expect(() => new GotenbergClient({ baseUrl: "" })).toThrow(RenderingConfigError);
    });

    it("rejects a username without a password (and vice versa)", () => {
        expect(() => client({ username: "launchstack" })).toThrow(RenderingConfigError);
        expect(() => client({ password: "secret" })).toThrow(RenderingConfigError);
    });

    it("strips trailing slashes from the base URL", async () => {
        mockFetch.mockResolvedValue(pdfResponse());
        await client({ baseUrl: "http://gotenberg:3000///" }).htmlToPdf({ html: "<p>hi</p>" });
        expect(mockFetch).toHaveBeenCalledWith(
            "http://gotenberg:3000/forms/chromium/convert/html",
            expect.anything()
        );
    });

    it("sends basic-auth credentials when configured", async () => {
        mockFetch.mockResolvedValue(pdfResponse());
        await client({ username: "launchstack", password: "secret" }).htmlToPdf({
            html: "<p>hi</p>",
        });
        const options = mockFetch.mock.calls[0]![1] as RequestInit;
        expect((options.headers as Record<string, string>).Authorization).toBe(
            `Basic ${Buffer.from("launchstack:secret").toString("base64")}`
        );
    });
});

describe("htmlToPdf", () => {
    it("posts index.html plus assets and returns the PDF with its trace", async () => {
        mockFetch.mockResolvedValue(pdfResponse({ "gotenberg-trace": "trace-123" }));

        const result = await client().htmlToPdf({
            html: "<html><body>doc</body></html>",
            assets: [{ filename: "logo.png", content: Buffer.from([1, 2, 3]) }],
            pageProperties: { ...PAPER_SIZES.a4, printBackground: true },
        });

        expect(result.pdf.subarray(0, 4).toString()).toBe("%PDF");
        expect(result.trace).toBe("trace-123");

        const form = (mockFetch.mock.calls[0]![1] as RequestInit).body as FormData;
        const files = form.getAll("files") as File[];
        expect(files.map(f => f.name)).toEqual(["index.html", "logo.png"]);
        expect(form.get("paperWidth")).toBe(String(PAPER_SIZES.a4.paperWidth));
        expect(form.get("printBackground")).toBe("true");
    });

    it("wraps a non-2xx response in RenderingServiceError with the trace", async () => {
        mockFetch.mockResolvedValue(
            new Response("Chromium failed to load the page", {
                status: 400,
                headers: { "gotenberg-trace": "trace-err" },
            })
        );

        const err = await client()
            .htmlToPdf({ html: "<p>x</p>" })
            .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(RenderingServiceError);
        expect((err as RenderingServiceError).statusCode).toBe(400);
        expect((err as RenderingServiceError).detail).toBe("Chromium failed to load the page");
        expect((err as RenderingServiceError).trace).toBe("trace-err");
    });

    it("maps a network failure to statusCode 0", async () => {
        mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

        const err = await client()
            .htmlToPdf({ html: "<p>x</p>" })
            .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(RenderingServiceError);
        expect((err as RenderingServiceError).statusCode).toBe(0);
        expect((err as RenderingServiceError).detail).toContain("ECONNREFUSED");
    });

    it("reports a timeout as such, not as a generic abort", async () => {
        const abortError = new Error("This operation was aborted");
        abortError.name = "AbortError";
        mockFetch.mockRejectedValue(abortError);

        const err = await client({ timeoutMs: 5 })
            .htmlToPdf({ html: "<p>x</p>" })
            .catch((e: unknown) => e);
        expect((err as RenderingServiceError).detail).toBe("request timed out after 5ms");
    });
});

describe("markdownToPdf", () => {
    it("uses the default wrapper with Gotenberg's toHTML hook", async () => {
        mockFetch.mockResolvedValue(pdfResponse());

        await client().markdownToPdf({ markdown: "# Title" });

        const form = (mockFetch.mock.calls[0]![1] as RequestInit).body as FormData;
        const files = form.getAll("files") as File[];
        expect(files.map(f => f.name)).toEqual(["index.html", "content.md"]);
        expect(await files[0]!.text()).toContain('{{ toHTML "content.md" }}');
        expect(await files[1]!.text()).toBe("# Title");
    });

    it("rejects a custom wrapper that dropped the toHTML hook", async () => {
        await expect(
            client().markdownToPdf({ markdown: "# T", wrapperHtml: "<html><body></body></html>" })
        ).rejects.toBeInstanceOf(RenderingConfigError);
        expect(mockFetch).not.toHaveBeenCalled();
    });
});

describe("officeToPdf", () => {
    it("posts the document under its own filename to the LibreOffice route", async () => {
        mockFetch.mockResolvedValue(pdfResponse());

        await client().officeToPdf({
            file: Buffer.from("PK\x03\x04fake-docx"),
            filename: "contract.docx",
            pdfa: "PDF/A-2b",
        });

        expect(mockFetch).toHaveBeenCalledWith(
            "http://gotenberg:3000/forms/libreoffice/convert",
            expect.anything()
        );
        const form = (mockFetch.mock.calls[0]![1] as RequestInit).body as FormData;
        expect((form.get("files") as File).name).toBe("contract.docx");
        expect(form.get("pdfa")).toBe("PDF/A-2b");
    });

    it("refuses extensions LibreOffice is not asked to handle", async () => {
        await expect(
            client().officeToPdf({ file: Buffer.from("x"), filename: "photo.png" })
        ).rejects.toBeInstanceOf(RenderingConfigError);
        await expect(
            client().officeToPdf({ file: Buffer.from("x"), filename: "no-extension" })
        ).rejects.toBeInstanceOf(RenderingConfigError);
        expect(mockFetch).not.toHaveBeenCalled();
    });
});

describe("health", () => {
    it("is true when the probe answers and false when it does not", async () => {
        mockFetch.mockResolvedValueOnce(new Response("{}", { status: 200 }));
        await expect(client().health()).resolves.toBe(true);

        mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
        await expect(client().health()).resolves.toBe(false);

        mockFetch.mockResolvedValueOnce(new Response("down", { status: 503 }));
        await expect(client().health()).resolves.toBe(false);
    });
});
