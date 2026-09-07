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

vi.mock("@launchstack/orchestration", () => ({
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

vi.mock("@launchstack/store/client", () => ({
    getDb: () => ({
        delete: (table: { _: { name?: string } } | object) => {
            deletions.push({ table: "table" in Object(table) ? "t" : "t" });
            return { where: async () => [] };
        },
    }),
}));

vi.mock("@launchstack/runtime", async importOriginal => ({
    ...(await importOriginal<object>()),
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

import { expandArchive, isTextFastPathFile, isZipFile } from "./archive-expansion";

async function makeZip(entries: Record<string, string>): Promise<Buffer> {
    const zip = new JSZip();
    for (const [path, content] of Object.entries(entries)) {
        zip.file(path, content);
    }
    return zip.generateAsync({ type: "nodebuffer" });
}

/**
 * Hand-rolled ZIP whose central directory lists the SAME entry name twice —
 * JSZip's `files` map would silently collapse the duplicate, so expansion
 * must reject the archive during load instead of processing an attacker's
 * chosen copy.
 */
function makeDuplicateEntryZip(): Buffer {
    const fileName = Buffer.from("duplicate.txt", "utf8");
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(fileName.length, 26);
    const localEntry = Buffer.concat([localHeader, fileName]);

    const makeCentralEntry = (localOffset: number) => {
        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(fileName.length, 28);
        centralHeader.writeUInt32LE(localOffset, 42);
        return Buffer.concat([centralHeader, fileName]);
    };

    const centralEntries = Buffer.concat([
        makeCentralEntry(0),
        makeCentralEntry(localEntry.length),
    ]);
    const endOfCentralDirectory = Buffer.alloc(22);
    endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
    endOfCentralDirectory.writeUInt16LE(2, 8);
    endOfCentralDirectory.writeUInt16LE(2, 10);
    endOfCentralDirectory.writeUInt32LE(centralEntries.length, 12);
    endOfCentralDirectory.writeUInt32LE(localEntry.length * 2, 16);

    return Buffer.concat([localEntry, localEntry, centralEntries, endOfCentralDirectory]);
}

function archiveInput(
    buffer: Buffer,
    overrides: Partial<Parameters<typeof expandArchive>[0]> = {}
) {
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
        fetchArchive: async () => new Response(new Uint8Array(buffer), { status: 200 }),
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
        const keys = lifecycleCalls.map(c => c.creationKey);
        expect(keys).toContain(JSON.stringify(["archive", "archive:test-1", "entry", "README.md"]));
        expect(keys).toContain(
            JSON.stringify(["archive", "archive:test-1", "entry", "src/app.py"])
        );
        expect(keys).toContain(JSON.stringify(["archive", "archive:test-1", "summary"]));

        // Every entry lifecycle carries the archive provenance columns.
        const entryCall = lifecycleCalls.find(c => c.sourceArchiveEntry === "src/app.py");
        expect(entryCall).toMatchObject({
            sourceArchiveName: "archive.zip",
            traceId: "trace-zip",
        });

        // The summary embeds the README and the file tree.
        const summaryUpload = uploads.find(u => u.filename.startsWith("_summary_"));
        expect(summaryUpload).toBeDefined();

        // Original ZIP job + document rows are deleted (two delete calls).
        expect(deletions).toHaveLength(2);
    });

    it("uses legacy string keys when no archiveIdentity was provided", async () => {
        const buffer = await makeZip({ "notes.txt": "hello" });
        await expandArchive(archiveInput(buffer, { archiveIdentity: undefined }));
        const keys = lifecycleCalls.map(c => c.creationKey);
        expect(keys).toContain("archive:7:entry:notes.txt");
    });

    it("fails loudly on a present-but-blank archiveIdentity", async () => {
        // Silently degrading to the legacy key path would fork the idempotency
        // keyspace across retries — a producer bug must surface, not converge
        // onto the wrong keys.
        const buffer = await makeZip({ "notes.txt": "hello" });
        await expect(
            expandArchive(archiveInput(buffer, { archiveIdentity: "   " }))
        ).rejects.toThrow(/archiveIdentity must not be blank/);
        expect(lifecycleCalls).toHaveLength(0);
    });

    it("rejects the whole archive when two entry paths canonicalize identically", async () => {
        // "nested/report.txt" and "nested/report.txt/" collapse to one canonical
        // path — processing either would let one entry mask the other.
        const zip = new JSZip();
        zip.file("nested/report.txt", "first");
        zip.file("nested/report.txt/", "duplicate");
        const buffer = await zip.generateAsync({ type: "nodebuffer" });

        await expect(expandArchive(archiveInput(buffer))).rejects.toThrow(
            /Duplicate ZIP entry path/
        );
        expect(uploads).toHaveLength(0);
        expect(lifecycleCalls).toHaveLength(0);
        expect(deletions).toHaveLength(0);
    });

    it("rejects exact duplicate central-directory entries before any upload", async () => {
        await expect(expandArchive(archiveInput(makeDuplicateEntryZip()))).rejects.toThrow(
            /Duplicate ZIP entry path/
        );
        expect(uploads).toHaveLength(0);
        expect(lifecycleCalls).toHaveLength(0);
        expect(deletions).toHaveLength(0);
    });

    it("indexes high-value files first when the archive exceeds the extraction cap", async () => {
        // 500 filler files sort lexicographically BEFORE README.md, so without
        // high-value-first ordering the cap would crowd the README out.
        const entries: Record<string, string> = {
            "README.md": "# The one that matters",
        };
        for (let i = 1; i <= 500; i++) {
            entries[`A-filler-${String(i).padStart(3, "0")}.txt`] = `filler ${i}`;
        }
        const buffer = await makeZip(entries);

        const result = await expandArchive(archiveInput(buffer));

        const indexed = lifecycleCalls.map(c => c.sourceArchiveEntry);
        expect(indexed).toContain("README.md");
        // The cap (500) dropped the lowest-priority filler, not the README.
        expect(indexed).not.toContain("A-filler-500.txt");
        const entryCalls = lifecycleCalls.filter(c => c.sourceArchiveEntry !== null);
        expect(entryCalls).toHaveLength(500);
        // 500 capped entries + 1 project summary.
        expect(result.extracted).toBe(501);
    });

    it("re-running the same archiveIdentity converges on identical creation keys", async () => {
        const buffer = await makeZip({ "docs/report.txt": "report" });

        // First attempt (e.g. the ZIP job that died mid-pipeline)…
        await expandArchive(archiveInput(buffer));
        const firstKeys = lifecycleCalls.map(c => c.creationKey);

        // …replayed later with a NEW source row and job id for the same logical
        // archive. Creation keys must depend only on the archive identity.
        lifecycleCalls.length = 0;
        await expandArchive(archiveInput(buffer, { sourceId: 8, ocrJobId: "zip-job-2" }));
        const secondKeys = lifecycleCalls.map(c => c.creationKey);

        expect(firstKeys).toEqual([
            JSON.stringify(["archive", "archive:test-1", "entry", "docs/report.txt"]),
            JSON.stringify(["archive", "archive:test-1", "summary"]),
        ]);
        expect(secondKeys).toEqual(firstKeys);
    });

    it("gives extensionless well-known files a text/plain mime", async () => {
        const buffer = await makeZip({
            Makefile: "all:\n\techo hi",
            Dockerfile: "FROM node:20",
        });

        await expandArchive(archiveInput(buffer));

        for (const name of ["Makefile", "Dockerfile"]) {
            const upload = uploads.find(u => u.filename === name);
            expect(upload, `${name} upload`).toBeDefined();
            expect(upload!.contentType).toBe("text/plain");
            const call = lifecycleCalls.find(c => c.sourceArchiveEntry === name);
            expect(call, `${name} lifecycle`).toBeDefined();
            expect(call!.mimeType).toBe("text/plain");
        }
    });

    it("titles nested entries by basename while provenance keeps the full path", async () => {
        const zip = new JSZip();
        // The doubled slash exercises canonicalization on the way in.
        zip.file("nested//docs/report.txt", "report");
        const buffer = await zip.generateAsync({ type: "nodebuffer" });

        await expandArchive(archiveInput(buffer));

        const entryCall = lifecycleCalls.find(
            c => c.sourceArchiveEntry === "nested/docs/report.txt"
        );
        expect(entryCall).toBeDefined();
        expect(entryCall).toMatchObject({
            title: "report.txt",
            sourceArchiveName: "archive.zip",
            creationKey: JSON.stringify([
                "archive",
                "archive:test-1",
                "entry",
                "nested/docs/report.txt",
            ]),
        });
        expect((entryCall!.processing as { originalFilename?: string }).originalFilename).toBe(
            "report.txt"
        );
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
        await expect(expandArchive(archiveInput(evil))).rejects.toThrow(/Invalid ZIP entry path/);
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
        const entries = lifecycleCalls.map(c => c.sourceArchiveEntry);
        expect(entries).toContain("keep.txt");
        expect(entries).not.toContain("bomb.zip");
    });

    it("skips oversized files instead of failing the archive", async () => {
        const big = "x".repeat(11 * 1024 * 1024);
        const buffer = await makeZip({ "big.txt": big, "small.txt": "ok" });
        const result = await expandArchive(archiveInput(buffer));
        const entries = lifecycleCalls.map(c => c.sourceArchiveEntry);
        expect(entries).toContain("small.txt");
        expect(entries).not.toContain("big.txt");
        // stats.indexed counts archive entries only; extracted adds the summary.
        expect(result.stats.indexed).toBe(1);
        expect(result.extracted).toBe(2);
    });

    it("throws when the archive cannot be fetched", async () => {
        await expect(
            expandArchive(
                archiveInput(Buffer.alloc(0), {
                    fetchArchive: async () => new Response("gone", { status: 404 }),
                })
            )
        ).rejects.toThrow(/Failed to fetch ZIP archive: 404/);
    });
});
