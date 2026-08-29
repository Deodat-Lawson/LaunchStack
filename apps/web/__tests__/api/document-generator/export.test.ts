/**
 * /api/document-generator/export: the PDF format renders through Gotenberg
 * only (ADR-009) — no pdf-lib fallback. Without the service it is a typed
 * 503 while the text formats keep working; with it, the PDF is printed from
 * the same styled HTML the html export ships.
 */

const mockRequireWorkspaceContext = jest.fn();

jest.mock("~/lib/require-workspace-context", () => ({
    requireWorkspaceContext: () => mockRequireWorkspaceContext(),
}));

const mockGetGotenbergClient = jest.fn();

jest.mock("~/server/rendering", () => ({
    getGotenbergClient: () => mockGetGotenbergClient(),
}));

import { RenderingServiceError } from "@launchstack/document-conversion-engine";
import { POST } from "~/app/api/document-generator/export/route";

function request(body: Record<string, unknown>): Request {
    return new Request("http://localhost/api/document-generator/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    mockRequireWorkspaceContext.mockResolvedValue({
        success: true,
        data: { companyId: "42", authUserId: "user_1" },
    });
});

describe("POST /api/document-generator/export", () => {
    it("503s the pdf format with a typed error when Gotenberg is not configured", async () => {
        mockGetGotenbergClient.mockReturnValue(null);
        const res = await POST(request({ format: "pdf", title: "Report", content: "# Hi" }));
        expect(res.status).toBe(503);
        const body = (await res.json()) as { error: string };
        expect(body.error).toBe("service_not_configured");
    });

    it("still serves the non-PDF formats without Gotenberg", async () => {
        mockGetGotenbergClient.mockReturnValue(null);
        for (const format of ["markdown", "html", "text"]) {
            const res = await POST(request({ format, title: "Report", content: "# Hi" }));
            expect(res.status).toBe(200);
        }
    });

    it("prints the styled HTML through Gotenberg with the chosen paper size", async () => {
        const htmlToPdf = jest
            .fn()
            .mockResolvedValue({ pdf: Buffer.from("%PDF-1.7 out"), trace: "t-1" });
        mockGetGotenbergClient.mockReturnValue({ htmlToPdf });

        const res = await POST(
            request({
                format: "pdf",
                title: "Quarterly Report",
                content: "# Numbers",
                options: { pageSize: "a4", bibliography: "Source one" },
            })
        );

        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("application/pdf");
        expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("%PDF-1.7 out");

        const params = htmlToPdf.mock.calls[0]![0] as {
            html: string;
            pageProperties: { paperWidth: number; printBackground: boolean };
        };
        // The PDF is the html export's document, not a separate rendering —
        // and a provided bibliography is always included.
        expect(params.html).toContain("<title>Quarterly Report</title>");
        expect(params.html).toContain("Source one");
        expect(params.pageProperties.paperWidth).toBeCloseTo(8.27);
        expect(params.pageProperties.printBackground).toBe(true);
    });

    it("relays a service 4xx and hides a service 5xx behind 502", async () => {
        const htmlToPdf = jest
            .fn()
            .mockRejectedValueOnce(new RenderingServiceError(400, "bad html", "t-4"))
            .mockRejectedValueOnce(new RenderingServiceError(503, "Chromium down", "t-5"));
        mockGetGotenbergClient.mockReturnValue({ htmlToPdf });

        const relayed = await POST(request({ format: "pdf", title: "R", content: "x" }));
        expect(relayed.status).toBe(400);

        const outage = await POST(request({ format: "pdf", title: "R", content: "x" }));
        expect(outage.status).toBe(502);
    });
});
