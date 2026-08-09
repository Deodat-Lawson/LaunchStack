import { describe, expect, it } from "vitest";

import {
  markdownToEvidenceDocument,
  parseBlocks,
  NO_PAGE_BOUNDARIES_WARNING,
} from "../src/evidence.js";
import { resolveUploadFilename } from "../src/docling.js";
import { expectValidEvidenceDocument } from "./helpers.js";

describe("parseBlocks", () => {
  it("splits headings, paragraphs and tables honestly", () => {
    const blocks = parseBlocks(
      [
        "## Section",
        "First paragraph line one.",
        "Line two of the same paragraph.",
        "",
        "Second paragraph.",
        "| a | b |",
        "| - | - |",
        "| 1 | 2 |",
        "Trailing paragraph.",
      ].join("\n"),
    );
    expect(blocks).toEqual([
      { type: "heading", text: "Section" },
      {
        type: "paragraph",
        text: "First paragraph line one.\nLine two of the same paragraph.",
      },
      { type: "paragraph", text: "Second paragraph." },
      { type: "table", text: "| a | b |\n| - | - |\n| 1 | 2 |" },
      { type: "paragraph", text: "Trailing paragraph." },
    ]);
  });

  it("returns no blocks for empty text", () => {
    expect(parseBlocks("")).toEqual([]);
  });
});

describe("markdownToEvidenceDocument", () => {
  it("splits on form-feed markers", () => {
    const doc = markdownToEvidenceDocument("page one\ftwo\fthree", {});
    expect(doc.pages.map((p) => p.text)).toEqual(["page one", "two", "three"]);
    expect(doc.source.pageCount).toBe(3);
    expect(doc.warnings).toEqual([]);
    expectValidEvidenceDocument(doc);
  });

  it("splits on <!-- page break --> markers, whitespace-insensitively", () => {
    const doc = markdownToEvidenceDocument(
      "one\n<!-- page break -->\ntwo\n<!--page break-->\nthree",
      {},
    );
    expect(doc.pages.map((p) => p.text)).toEqual(["one", "two", "three"]);
    expectValidEvidenceDocument(doc);
  });

  it("never treats --- as a page boundary (the old defect)", () => {
    const doc = markdownToEvidenceDocument("alpha\n\n---\n\nbeta", {});
    expect(doc.pages).toHaveLength(1);
    expect(doc.warnings).toEqual([NO_PAGE_BOUNDARIES_WARNING]);
    expect(doc.source.pageCount).toBeUndefined();
    expectValidEvidenceDocument(doc);
  });

  it("drops empty edge chunks created by leading/trailing markers", () => {
    const doc = markdownToEvidenceDocument("\fonly page\f", {});
    expect(doc.pages.map((p) => p.text)).toEqual(["only page"]);
    expect(doc.pages[0].pageNumber).toBe(1);
    expectValidEvidenceDocument(doc);
  });

  it("carries source metadata and the full markdown, without confidence", () => {
    const doc = markdownToEvidenceDocument("# Hello\f## World", {
      filename: "hello.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    expect(doc.provider).toBe("docling");
    expect(doc.source.filename).toBe("hello.docx");
    expect(doc.markdown).toBe("# Hello\f## World");
    expect(doc).not.toHaveProperty("confidence");
    expect(doc.pages[0].blocks).toEqual([{ type: "heading", text: "Hello" }]);
    expectValidEvidenceDocument(doc);
  });
});

describe("resolveUploadFilename", () => {
  it("prefers the request filename", () => {
    expect(
      resolveUploadFilename({
        schemaVersion: 1,
        url: "http://files.test/x",
        filename: "contract.docx",
      }),
    ).toBe("contract.docx");
  });

  it("falls back to the URL basename", () => {
    expect(
      resolveUploadFilename({
        schemaVersion: 1,
        url: "http://files.test/uploads/report%20final.pdf?sig=abc",
      }),
    ).toBe("report final.pdf");
  });

  it("derives an extension from the mime type when there is none", () => {
    expect(
      resolveUploadFilename({
        schemaVersion: 1,
        url: "http://files.test/blob/12345",
        mimeType: "application/pdf",
      }),
    ).toBe("12345.pdf");
  });

  it("uses .bin when nothing better is known", () => {
    expect(
      resolveUploadFilename({
        schemaVersion: 1,
        url: "http://files.test/blob/12345",
      }),
    ).toBe("12345.bin");
  });
});
