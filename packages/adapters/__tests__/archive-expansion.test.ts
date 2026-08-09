/**
 * Behavioral pins for ZIP archive expansion, ported from the retired web
 * `process-document` Inngest function test: zip-slip defenses, skip
 * patterns, provenance creation keys, per-entry lifecycle fan-out, summary
 * document, and deletion of the original ZIP source.
 */
import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";

const lifecycleCalls: Array<Record<string, unknown>> = [];
const uploads: Array<{ filename: string; contentType?: string }> = [];
const deletions: Array<{ table: string }> = [];

vi.mock("../src/ingestion/source-lifecycle", () => ({
  createDocumentLifecycle: vi.fn(async (params: Record<string, unknown>) => {
    lifecycleCalls.push(params);
    return {
      documentId: 1000 + lifecycleCalls.length,
      versionId: 2000 + lifecycleCalls.length,
      jobId: `job-${lifecycleCalls.length}`,
      eventIds: [],
      document: {},
      version: {},
      job: null,
    };
  }),
}));

vi.mock("../src/db", () => ({
  getDb: () => ({
    delete: (table: { _: { name?: string } } | object) => {
      deletions.push({ table: "table" in Object(table) ? "t" : "t" });
      return { where: async () => [] };
    },
  }),
}));

vi.mock("../src/storage", () => ({
  getStoragePort: () => ({
    provider: "test",
    upload: vi.fn(async (input: { filename: string; contentType?: string }) => {
      uploads.push({ filename: input.filename, contentType: input.contentType });
      return {
        url: `stored://${input.filename}`,
        pathname: input.filename,
        provider: "test",
      };
    }),
    download: vi.fn(),
    delete: vi.fn(),
  }),
}));

import { expandArchive, isTextFastPathFile, isZipFile } from "../src/ingestion/archive-expansion";

async function makeZip(entries: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(entries)) {
    zip.file(path, content);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

function archiveInput(buffer: Buffer, overrides: Partial<Parameters<typeof expandArchive>[0]> = {}) {
  return {
    companyId: 42,
    sourceId: 7,
    ocrJobId: "zip-job-1",
    documentUrl: "stored://archive.zip",
    documentName: "archive.zip",
    category: "General",
    userId: "user_test",
    archiveIdentity: "archive:test-1",
    traceId: "trace-zip",
    fetchArchive: async () =>
      new Response(new Uint8Array(buffer), { status: 200 }),
    ...overrides,
  };
}

beforeEach(() => {
  lifecycleCalls.length = 0;
  uploads.length = 0;
  deletions.length = 0;
  vi.clearAllMocks();
});

describe("detection helpers", () => {
  it("detects ZIPs by mime and extension", () => {
    expect(isZipFile("application/zip", "a.bin")).toBe(true);
    expect(isZipFile(undefined, "repo.ZIP")).toBe(true);
    expect(isZipFile("application/pdf", "doc.pdf")).toBe(false);
  });

  it("detects text fast-path files by mime, extension and well-known names", () => {
    expect(isTextFastPathFile("text/markdown", undefined)).toBe(true);
    expect(isTextFastPathFile(undefined, "src/main.rs")).toBe(true);
    expect(isTextFastPathFile(undefined, "Dockerfile")).toBe(true);
    expect(isTextFastPathFile("application/pdf", "doc.pdf")).toBe(false);
  });
});

describe("expandArchive", () => {
  it("fans out entries with stable provenance keys, writes a summary, deletes the ZIP", async () => {
    const buffer = await makeZip({
      "README.md": "# Project\nHello",
      "src/app.py": "print('hi')",
      "__MACOSX/junk": "resource fork",
      ".DS_Store": "junk",
      "node_modules/dep/index.js": "skip me",
    });

    const result = await expandArchive(archiveInput(buffer));

    // README + src/app.py indexed, junk skipped, +1 project summary.
    expect(result.extracted).toBe(3);
    const keys = lifecycleCalls.map((c) => c.creationKey);
    expect(keys).toContain(
      JSON.stringify(["archive", "archive:test-1", "entry", "README.md"]),
    );
    expect(keys).toContain(
      JSON.stringify(["archive", "archive:test-1", "entry", "src/app.py"]),
    );
    expect(keys).toContain(JSON.stringify(["archive", "archive:test-1", "summary"]));

    // Every entry lifecycle carries the archive provenance columns.
    const entryCall = lifecycleCalls.find(
      (c) => c.sourceArchiveEntry === "src/app.py",
    );
    expect(entryCall).toMatchObject({
      sourceArchiveName: "archive.zip",
      traceId: "trace-zip",
    });

    // The summary embeds the README and the file tree.
    const summaryUpload = uploads.find((u) => u.filename.startsWith("_summary_"));
    expect(summaryUpload).toBeDefined();

    // Original ZIP job + document rows are deleted (two delete calls).
    expect(deletions).toHaveLength(2);
  });

  it("uses legacy string keys when no archiveIdentity was provided", async () => {
    const buffer = await makeZip({ "notes.txt": "hello" });
    await expandArchive(archiveInput(buffer, { archiveIdentity: undefined }));
    const keys = lifecycleCalls.map((c) => c.creationKey);
    expect(keys).toContain("archive:7:entry:notes.txt");
  });

  it("rejects zip-slip entries (path traversal)", async () => {
    const zip = new JSZip();
    zip.file("ok.txt", "fine");
    // JSZip normalizes paths on file(); craft the traversal via the raw map.
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    // JSZip materializes the parent folder chain, so the first guard to fire
    // may be the traversal or the empty-after-normalize check — both are the
    // zip-slip defense rejecting the archive outright.
    const evil = await makeZip({ "nested/../../etc/passwd": "root" });
    await expect(expandArchive(archiveInput(evil))).rejects.toThrow(
      /Invalid ZIP entry path/,
    );
    // The safe archive still works.
    await expect(expandArchive(archiveInput(buffer))).resolves.toBeDefined();
  });

  it("skips nested ZIP entries instead of recursing", async () => {
    const inner = await makeZip({ "inner.txt": "x" });
    const zip = new JSZip();
    zip.file("keep.txt", "keep");
    zip.file("bomb.zip", inner);
    const buffer = await zip.generateAsync({ type: "nodebuffer" });

    await expandArchive(archiveInput(buffer));
    const entries = lifecycleCalls.map((c) => c.sourceArchiveEntry);
    expect(entries).toContain("keep.txt");
    expect(entries).not.toContain("bomb.zip");
  });

  it("skips oversized files instead of failing the archive", async () => {
    const big = "x".repeat(11 * 1024 * 1024);
    const buffer = await makeZip({ "big.txt": big, "small.txt": "ok" });
    const result = await expandArchive(archiveInput(buffer));
    const entries = lifecycleCalls.map((c) => c.sourceArchiveEntry);
    expect(entries).toContain("small.txt");
    expect(entries).not.toContain("big.txt");
    expect(result.stats.indexed).toBe(result.extracted);
  });

  it("throws when the archive cannot be fetched", async () => {
    await expect(
      expandArchive(
        archiveInput(Buffer.alloc(0), {
          fetchArchive: async () => new Response("gone", { status: 404 }),
        }),
      ),
    ).rejects.toThrow(/Failed to fetch ZIP archive: 404/);
  });
});
