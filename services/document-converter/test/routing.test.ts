import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";

import type { AppDeps } from "../src/app.js";
import type { Config } from "../src/config.js";
import type { RouteResponse } from "../src/contracts.js";
import {
  ALLOWED_ORIGIN,
  bytesFetch,
  forbiddenFetch,
  postJson,
  startApp,
  testConfig,
  type TestServer,
} from "./helpers.js";

const DOC_URL = `${ALLOWED_ORIGIN}/doc.pdf`;

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function route(
  config: Config,
  deps: AppDeps,
  body: Record<string, unknown>,
): Promise<RouteResponse> {
  server = await startApp(config, deps);
  const res = await postJson(server.url, "/route", {
    schemaVersion: 1,
    documentUrl: DOC_URL,
    ...body,
  });
  expect(res.status).toBe(200);
  return (await res.json()) as RouteResponse;
}

async function makeAcroFormPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const field = doc.getForm().createTextField("applicant.name");
  field.addToPage(page, { x: 40, y: 120, width: 200, height: 30 });
  return doc.save();
}

async function makeTextPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 400]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(
    "This is a digitally generated PDF document with a fully extractable",
    { x: 40, y: 300, size: 12, font },
  );
  page.drawText(
    "text layer used to exercise the native text-layer routing path.",
    { x: 40, y: 280, size: 12, font },
  );
  return doc.save();
}

async function makeEmptyPdf(pages = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([300, 300]);
  return doc.save();
}

describe("POST /route", () => {
  it("honors preferredProvider without fetching the document", async () => {
    const calls: string[] = [];
    const body = await route(
      testConfig(),
      { fetchImpl: forbiddenFetch(calls) },
      { preferredProvider: "AZURE" },
    );
    expect(body).toEqual({
      schemaVersion: 1,
      provider: "AZURE",
      reason: "preferred-provider",
      signals: {},
    });
    expect(calls).toEqual([]);
  });

  it("forceOCR picks the default provider without fetching", async () => {
    const body = await route(
      testConfig({ doclingServeUrl: "http://docling.test:5001" }),
      { fetchImpl: forbiddenFetch() },
      { forceOCR: true },
    );
    expect(body.provider).toBe("DOCLING");
    expect(body.reason).toBe("force-ocr");
    expect(body.signals).toEqual({});
  });

  it("forceOCR never yields NATIVE_PDF (remapped via the complex chain)", async () => {
    const body = await route(
      testConfig({
        defaultProvider: "NATIVE_PDF",
        landingAiApiKey: "landing-key",
      }),
      { fetchImpl: forbiddenFetch() },
      { forceOCR: true },
    );
    expect(body.provider).toBe("LANDING_AI");
    expect(body.reason).toBe("force-ocr");
  });

  it("routes AcroForm PDFs to NATIVE_PDF with a real signal", async () => {
    const pdf = await makeAcroFormPdf();
    const body = await route(testConfig(), { fetchImpl: bytesFetch(pdf) }, {});
    expect(body.provider).toBe("NATIVE_PDF");
    expect(body.reason).toBe("interactive-form");
    expect(body.signals.hasInteractiveForm).toBe(true);
    expect(body.pageCount).toBe(1);
    // The old fabricated confidence is GONE from the wire.
    expect(body).not.toHaveProperty("confidence");
  });

  it("routes text-layer PDFs to NATIVE_PDF with measured sample length", async () => {
    const pdf = await makeTextPdf();
    const body = await route(testConfig(), { fetchImpl: bytesFetch(pdf) }, {});
    expect(body.provider).toBe("NATIVE_PDF");
    expect(body.reason).toBe("native-text-layer");
    expect(body.signals.textSampleChars).toBeGreaterThan(50);
    expect(body.signals.hasInteractiveForm).toBe(false);
    expect(body.pageCount).toBe(1);
    expect(body).not.toHaveProperty("confidence");
  });

  it("routes complex vision results to the complex-doc provider", async () => {
    const pdf = await makeEmptyPdf();
    const body = await route(
      testConfig({
        landingAiApiKey: "landing-key",
        azureEndpoint: "https://azure.test",
        azureKey: "azure-key",
      }),
      {
        fetchImpl: bytesFetch(pdf),
        renderPages: async () => [new Uint8Array([1, 2, 3])],
        classify: async () => ({ label: "handwritten notes", score: 0.91 }),
      },
      {},
    );
    // Complex chain ranks LandingAI above Azure (preserved priority).
    expect(body.provider).toBe("LANDING_AI");
    expect(body.reason).toBe("vision-complex");
    expect(body.signals.visionLabel).toBe("handwritten notes");
    expect(body.signals.visionScore).toBeCloseTo(0.91);
    expect(body.pageCount).toBe(2);
  });

  it("routes simple vision results to the default provider", async () => {
    const pdf = await makeEmptyPdf();
    const body = await route(
      testConfig({
        landingAiApiKey: "landing-key",
        azureEndpoint: "https://azure.test",
        azureKey: "azure-key",
      }),
      {
        fetchImpl: bytesFetch(pdf),
        renderPages: async () => [new Uint8Array([1, 2, 3])],
        classify: async () => ({ label: "digital text document", score: 0.8 }),
      },
      {},
    );
    // Default chain ranks Azure above LandingAI (preserved priority).
    expect(body.provider).toBe("AZURE");
    expect(body.reason).toBe("vision-simple");
    expect(body.signals.visionLabel).toBe("digital text document");
  });

  it("a complex label below the routing threshold stays with the default provider", async () => {
    const pdf = await makeEmptyPdf();
    const body = await route(
      testConfig({ datalabApiKey: "datalab-key" }),
      {
        fetchImpl: bytesFetch(pdf),
        renderPages: async () => [new Uint8Array([1])],
        classify: async () => ({ label: "receipt or invoice", score: 0.4 }),
      },
      {},
    );
    expect(body.provider).toBe("DATALAB");
    expect(body.reason).toBe("vision-simple");
    expect(body.signals.visionScore).toBeCloseTo(0.4);
  });

  it("reports vision-unavailable when no pages could be rendered — no fabricated 0.5", async () => {
    const pdf = await makeEmptyPdf();
    const body = await route(
      testConfig({ doclingServeUrl: "http://docling.test:5001" }),
      { fetchImpl: bytesFetch(pdf), renderPages: async () => [] },
      {},
    );
    expect(body.provider).toBe("DOCLING");
    expect(body.reason).toBe("vision-unavailable");
    expect(body.signals.visionScore).toBeUndefined();
    expect(body).not.toHaveProperty("confidence");
  });

  it("reports vision-unavailable when the classifier throws", async () => {
    const pdf = await makeEmptyPdf();
    const body = await route(
      testConfig(),
      {
        fetchImpl: bytesFetch(pdf),
        renderPages: async () => [new Uint8Array([1])],
        classify: async () => {
          throw new Error("vision backend down");
        },
      },
      {},
    );
    expect(body.provider).toBe("DOCLING");
    expect(body.reason).toBe("vision-unavailable");
  });

  it("labels non-PDF bytes not-a-pdf", async () => {
    const body = await route(
      testConfig({ doclingServeUrl: "http://docling.test:5001" }),
      { fetchImpl: bytesFetch(new TextEncoder().encode("hello, world")) },
      {},
    );
    expect(body.provider).toBe("DOCLING");
    expect(body.reason).toBe("not-a-pdf");
    expect(body.pageCount).toBeUndefined();
  });

  it("honors the operator default provider on the default chain", async () => {
    const body = await route(
      testConfig({
        defaultProvider: "DATALAB",
        doclingServeUrl: "http://docling.test:5001",
      }),
      { fetchImpl: bytesFetch(new TextEncoder().encode("not a pdf")) },
      {},
    );
    expect(body.provider).toBe("DATALAB");
  });

  it("maps a failing document fetch to a typed fetch-failed error", async () => {
    server = await startApp(testConfig(), {
      fetchImpl: async () => new Response("gone", { status: 404 }),
    });
    const res = await postJson(server.url, "/route", {
      schemaVersion: 1,
      documentUrl: DOC_URL,
    });
    expect(res.status).toBe(502);
    const payload = (await res.json()) as { error: { code: string } };
    expect(payload.error.code).toBe("fetch-failed");
  });

  it("enforces MAX_FETCH_BYTES while streaming", async () => {
    server = await startApp(testConfig({ maxFetchBytes: 64 }), {
      fetchImpl: bytesFetch(new Uint8Array(1024)),
    });
    const res = await postJson(server.url, "/route", {
      schemaVersion: 1,
      documentUrl: DOC_URL,
    });
    expect(res.status).toBe(413);
    const payload = (await res.json()) as { error: { code: string } };
    expect(payload.error.code).toBe("fetch-too-large");
  });

  it("rejects a body without schemaVersion", async () => {
    server = await startApp(testConfig(), { fetchImpl: forbiddenFetch() });
    const res = await postJson(server.url, "/route", { documentUrl: DOC_URL });
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { error: { code: string } };
    expect(payload.error.code).toBe("invalid-request");
  });

  it("rejects MARKER as preferredProvider (no longer in the wire enum)", async () => {
    server = await startApp(testConfig(), { fetchImpl: forbiddenFetch() });
    const res = await postJson(server.url, "/route", {
      schemaVersion: 1,
      documentUrl: DOC_URL,
      preferredProvider: "MARKER",
    });
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { error: { code: string } };
    expect(payload.error.code).toBe("invalid-request");
  });
});
