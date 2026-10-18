/**
 * The workspace's processing method is applied server-side to every new PDF
 * that arrives without an explicit choice: resolved for the folder it lands
 * in (nearest folder override, else the workspace, else Automatic), mapped
 * to a provider pin, and handed to the lifecycle — for new documents (upload,
 * Drive, Gmail) and new versions alike.
 */

import type { StoredSettingRow } from "~/server/settings/resolve";

let mockStoredRows: StoredSettingRow[] = [];
let mockFailRead = false;

/** Stands in for `db.select(...).from(settings_values).where(...)`. */
jest.mock("~/server/db", () => ({
    db: {
        select: () => ({
            from: () => ({
                where: async () => {
                    if (mockFailRead) throw new Error("connection refused");
                    return mockStoredRows;
                },
            }),
        }),
    },
}));

const mockCoreCreate = jest.fn(async (params: unknown) => ({ params }));
const mockCoreVersion = jest.fn(async (params: unknown) => ({ params }));
jest.mock("@launchstack/orchestration", () => ({
    createDocumentLifecycle: (params: unknown) => mockCoreCreate(params),
    createDocumentVersionLifecycle: (params: unknown) => mockCoreVersion(params),
    findDocumentByCreationKey: jest.fn(),
}));

import { getSetting } from "~/lib/settings/registry";
import {
    createDocumentLifecycle,
    createDocumentVersionLifecycle,
} from "~/server/services/document-creation";
import {
    defaultProviderFor,
    providerForMethod,
    resolveProcessingMethod,
} from "~/server/settings/processing-method";

const KEY = "documents.defaultProcessingMethod";

function row(scopeType: "workspace" | "folder", scopeId: string, value: string): StoredSettingRow {
    return { scopeType, scopeId, key: KEY, value, updatedBy: "u1", updatedAt: null };
}

beforeEach(() => {
    mockStoredRows = [];
    mockFailRead = false;
    mockCoreCreate.mockClear();
    mockCoreVersion.mockClear();
});

describe("documents.defaultProcessingMethod", () => {
    it("defaults to Automatic, with Text layer only as the explicit no-OCR choice", () => {
        const definition = getSetting(KEY)!;
        expect(definition.default).toBe("auto");
        if (definition.control.kind !== "select") throw new Error("expected a select");
        const labels = Object.fromEntries(
            definition.control.options.map(option => [option.value, option.label])
        );
        expect(labels).toMatchObject({ auto: "Automatic", standard: "Text layer only" });
        for (const option of definition.control.options) {
            expect(option.description).toBeTruthy();
        }
    });

    it("maps each method to the provider pin it stands for", () => {
        expect(providerForMethod("auto")).toBeUndefined();
        expect(providerForMethod("standard")).toBe("NATIVE_PDF");
        expect(providerForMethod("azure")).toBe("AZURE");
        expect(providerForMethod("docling")).toBe("DOCLING");
        expect(providerForMethod("landing_ai")).toBe("LANDING_AI");
        expect(providerForMethod("datalab")).toBe("DATALAB");
    });
});

describe("resolveProcessingMethod", () => {
    it("is Automatic when nothing is stored", async () => {
        await expect(resolveProcessingMethod(BigInt(1), "Legal")).resolves.toBe("auto");
    });

    it("uses the workspace value outside any overriding folder", async () => {
        mockStoredRows = [row("workspace", "", "docling"), row("folder", "Finance", "standard")];
        await expect(resolveProcessingMethod(BigInt(1), "Legal")).resolves.toBe("docling");
        await expect(resolveProcessingMethod(BigInt(1), null)).resolves.toBe("docling");
    });

    it("lets the nearest folder override win over its ancestors and the workspace", async () => {
        mockStoredRows = [
            row("workspace", "", "azure"),
            row("folder", "Legal", "standard"),
            row("folder", "Legal/Scans", "docling"),
        ];
        await expect(resolveProcessingMethod(BigInt(1), "Legal/Scans/2026")).resolves.toBe(
            "docling"
        );
        await expect(resolveProcessingMethod(BigInt(1), "Legal/Contracts")).resolves.toBe(
            "standard"
        );
    });
});

describe("defaultProviderFor", () => {
    it("pins only PDFs — images and text never read a pin", async () => {
        mockStoredRows = [row("workspace", "", "azure")];
        const base = { companyId: BigInt(1), category: "Legal" };
        await expect(
            defaultProviderFor({ ...base, mimeType: "application/pdf", filename: "a.pdf" })
        ).resolves.toBe("AZURE");
        await expect(
            defaultProviderFor({ ...base, mimeType: null, filename: "Scan.PDF" })
        ).resolves.toBe("AZURE");
        await expect(
            defaultProviderFor({ ...base, mimeType: "image/png", filename: "a.png" })
        ).resolves.toBeUndefined();
    });

    it("falls back to Automatic rather than blocking the upload when settings cannot be read", async () => {
        mockFailRead = true;
        await expect(
            defaultProviderFor({
                companyId: BigInt(1),
                category: "Legal",
                mimeType: "application/pdf",
                filename: "a.pdf",
            })
        ).resolves.toBeUndefined();
    });
});

describe("document creation applies the default", () => {
    const pdfDocument = {
        companyId: BigInt(1),
        userId: "u1",
        title: "Contract",
        category: "Legal",
        url: "/api/files/1",
        creationKey: "k",
        mimeType: "application/pdf",
    };

    it("gives a new PDF with no choice the destination folder's method (Drive and Gmail send none)", async () => {
        mockStoredRows = [row("workspace", "", "azure"), row("folder", "Legal", "standard")];

        await createDocumentLifecycle({
            ...pdfDocument,
            processing: { originalFilename: "contract.pdf" },
        });

        expect(mockCoreCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                processing: { originalFilename: "contract.pdf", preferredProvider: "NATIVE_PDF" },
            })
        );
    });

    it("leaves Automatic unpinned so the converter's order decides", async () => {
        await createDocumentLifecycle({
            ...pdfDocument,
            processing: { originalFilename: "contract.pdf" },
        });

        expect(mockCoreCreate).toHaveBeenCalledWith(
            expect.objectContaining({ processing: { originalFilename: "contract.pdf" } })
        );
    });

    it("never overrides an explicit pick", async () => {
        mockStoredRows = [row("workspace", "", "standard")];

        await createDocumentLifecycle({
            ...pdfDocument,
            processing: { preferredProvider: "AZURE", originalFilename: "contract.pdf" },
        });

        expect(mockCoreCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                processing: { preferredProvider: "AZURE", originalFilename: "contract.pdf" },
            })
        );
    });

    it("does not touch a document with no processing job", async () => {
        mockStoredRows = [row("workspace", "", "azure")];
        await createDocumentLifecycle({ ...pdfDocument });
        expect(mockCoreCreate).toHaveBeenCalledWith(pdfDocument);
    });

    it("gives a new version with no choice the method of the folder its document is in", async () => {
        mockStoredRows = [row("workspace", "", "docling")];

        await createDocumentVersionLifecycle({
            ...pdfDocument,
            documentId: 5,
            originalFilename: "contract-v2.pdf",
        });

        expect(mockCoreVersion).toHaveBeenCalledWith(
            expect.objectContaining({ documentId: 5, preferredProvider: "DOCLING" })
        );
    });
});
