/**
 * The Privacy screen's OCR row says where PDFs and images actually go, in the
 * order ingestion tries them — from the provider credentials, not from the
 * removed ocr-router/ocr-worker variables.
 */

jest.mock("~/env", () => ({ env: { server: {} } }));
jest.mock("~/server/deployment", () => ({ getDeploymentMode: () => "self-hosted" }));

import { privacyOverview } from "~/server/settings/privacy";

const serverEnv = jest.requireMock<{ env: { server: Record<string, string | undefined> } }>("~/env")
    .env.server;

function ocrRow() {
    return privacyOverview().services.find(service => service.id === "ocr")!;
}

beforeEach(() => {
    for (const key of Object.keys(serverEnv)) delete serverEnv[key];
});

describe("Privacy › OCR", () => {
    it("names Azure's host and the fallback order when Azure is configured", () => {
        Object.assign(serverEnv, {
            AZURE_DOC_INTELLIGENCE_ENDPOINT: "https://docintel.cognitiveservices.azure.com/",
            AZURE_DOC_INTELLIGENCE_KEY: "k",
            DOCUMENT_CONVERTER_URL: "http://document-converter:8002",
        });
        const row = ocrRow();
        expect(row.host).toBe("docintel.cognitiveservices.azure.com");
        expect(row.sends).toBe("document-text");
        expect(row.note).toMatch(/^Every PDF and image is read with OCR\./);
        expect(row.note).toMatch(/Azure Document Intelligence reads every page; Docling/);
        expect(row.note).toMatch(/text layer is the last resort/);
        expect(row.note).toMatch(/a scan none of them can read is retried, not indexed blank/);
        // The page words the plan in the reader's language, not the English note.
        expect(row.ocr).toEqual({ scope: "all", order: ["AZURE", "DOCLING"] });
    });

    it("says only scans reach OCR under OCR_PDF_STRATEGY=text-layer-first", () => {
        Object.assign(serverEnv, {
            AZURE_DOC_INTELLIGENCE_ENDPOINT: "https://docintel.cognitiveservices.azure.com/",
            AZURE_DOC_INTELLIGENCE_KEY: "k",
            OCR_PDF_STRATEGY: "text-layer-first",
        });
        const row = ocrRow();
        expect(row.host).toBe("docintel.cognitiveservices.azure.com");
        expect(row.note).toMatch(
            /^Images and scanned PDFs are read with OCR; a PDF with its own text layer is read from it/
        );
        expect(row.note).not.toMatch(/last resort/);
        expect(row.ocr?.scope).toBe("scans");
    });

    it("keeps Docling local: nothing leaves the deployment", () => {
        Object.assign(serverEnv, { DOCUMENT_CONVERTER_URL: "http://document-converter:8002" });
        const row = ocrRow();
        expect(row.host).toBeNull();
        expect(row.sends).toBe("none");
        expect(row.enabled).toBe(true);
        expect(row.note).toMatch(/Docling on this deployment/);
    });

    it("says plainly when there is no OCR at all", () => {
        const row = ocrRow();
        expect(row.enabled).toBe(false);
        expect(row.note).toMatch(/No OCR service is configured/);
        expect(row.note).toMatch(/scanned pages come out blank/);
        expect(row.ocr).toEqual({ scope: "none", order: [] });
    });

    it("no longer reads the removed OCR_ROUTER_URL/OCR_WORKER_URL as an OCR host", () => {
        Object.assign(serverEnv, { OCR_WORKER_URL: "http://ocr-worker.example:8000" });
        expect(JSON.stringify(ocrRow())).not.toContain("ocr-worker.example");
    });
});
