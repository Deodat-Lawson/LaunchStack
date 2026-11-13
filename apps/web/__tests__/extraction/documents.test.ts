/**
 * The pure halves of the ports: which files count as images, which of them a
 * vision model takes, and how a vision model's flat answer becomes cells.
 * Also: the row-failure sentences the catalogue words are the engine's own.
 */
jest.mock("~/server/db", () => ({ db: {} }));
jest.mock("~/lib/require-workspace-context", () => ({ resolveMemberContext: jest.fn() }));
jest.mock("~/lib/models", () => ({ resolveConfiguredChatModel: jest.fn() }));
jest.mock("~/lib/storage", () => ({ fetchFile: jest.fn() }));
jest.mock("~/lib/authz/scope", () => ({ scopedDocumentWhere: jest.fn() }));

import {
    ALL_ROWS_FAILED_MESSAGE,
    DOCUMENT_UNAVAILABLE_MESSAGE,
} from "@launchstack/pipelines/extraction";
import type { ExtractionField } from "@launchstack/pipelines/extraction/types";

import en from "~/i18n/messages/en/extractServer.json";
import {
    readImageFields,
    visionCells,
    visionPrompt,
    visionSchema,
} from "~/server/extraction/documents";
import { isImageFile, sourceKindOf, visionMimeOf } from "~/server/extraction/kinds";
import { rowErrorText, tableErrorText } from "~/server/extraction/views";

const { resolveMemberContext } = jest.requireMock<{ resolveMemberContext: jest.Mock }>(
    "~/lib/require-workspace-context"
);

const FIELDS: ExtractionField[] = [
    { id: "f1", name: "Total", type: "number", instruction: "The amount due" },
    { id: "f2", name: "Paid", type: "boolean" },
    { id: "f3", name: "Vendor", type: "text" },
];

describe("file kinds", () => {
    it("knows an image by its stored type or its extension", () => {
        expect(isImageFile({ title: "Receipt", mimeType: "image/png" })).toBe(true);
        expect(isImageFile({ title: "scan.TIFF", mimeType: null })).toBe(true);
        expect(isImageFile({ title: "Receipt", url: "/files/a.bmp?x=1" })).toBe(true);
        expect(isImageFile({ title: "Contract.pdf", mimeType: "application/pdf" })).toBe(false);
    });

    it("sends a vision model only the image types it takes", () => {
        expect(visionMimeOf({ title: "a.jpg" })).toBe("image/jpeg");
        expect(visionMimeOf({ title: "Receipt", served: "image/webp; charset=binary" })).toBe(
            "image/webp"
        );
        expect(visionMimeOf({ title: "scan.png", mimeType: "image/tiff" })).toBeNull();
        expect(visionMimeOf({ title: "scan.tiff" })).toBeNull();
        expect(visionMimeOf({ title: "scan.bmp", served: "application/octet-stream" })).toBeNull();
    });

    it("names the kind for the icon", () => {
        expect(sourceKindOf({ title: "Plan.docx" })).toBe("docx");
        expect(sourceKindOf({ title: "Deck", mimeType: "application/vnd.ms-powerpoint" })).toBe(
            "pptx"
        );
        expect(sourceKindOf({ title: "Standup (transcription)" })).toBe("transcript");
        expect(sourceKindOf({ title: "Untitled" })).toBe("file");
    });
});

describe("vision answers", () => {
    it("asks for a flat object of strings: a value and a quote per field", () => {
        const schema = visionSchema(FIELDS);
        expect(Object.keys(schema.shape)).toEqual([
            "f1",
            "f1_quote",
            "f2",
            "f2_quote",
            "f3",
            "f3_quote",
        ]);
        expect(visionPrompt("Receipt.png", FIELDS)).toContain(
            "- f1 (number): Total — The amount due"
        );
    });

    it("types values the engine's way and marks every cell as read from the image", () => {
        const cells = visionCells(FIELDS, {
            f1: "1,250.50",
            f1_quote: "  TOTAL   $1,250.50 ",
            f2: "yes",
            f2_quote: "",
            f3: "",
            f3_quote: "ignored without a value",
        });
        expect(cells.f1).toEqual({
            status: "found",
            value: 1250.5,
            quote: "TOTAL $1,250.50",
            page: null,
            via: "vision",
        });
        expect(cells.f2).toMatchObject({ status: "found", value: true, quote: null });
        expect(cells.f3).toEqual({
            status: "not_found",
            value: null,
            quote: null,
            page: null,
            via: "vision",
        });
    });

    it("never throws: a failure anywhere leaves the fields not found", async () => {
        resolveMemberContext.mockRejectedValue(new Error("database is down"));
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        await expect(
            readImageFields({
                table: { companyId: BigInt(5), createdByUserId: "creator" } as never,
                row: { documentId: 12 } as never,
                fields: FIELDS,
            })
        ).resolves.toBeNull();
        warn.mockRestore();
    });

    it("reads nothing for a creator who is no longer a member", async () => {
        resolveMemberContext.mockResolvedValue(null);
        await expect(
            readImageFields({
                table: { companyId: BigInt(5), createdByUserId: "gone" } as never,
                row: { documentId: 12 } as never,
                fields: FIELDS,
            })
        ).resolves.toBeNull();
    });
});

describe("failure sentences", () => {
    it("are the engine's own, so they are worded in the reader's language", () => {
        expect(en.rowErrors.documentUnavailable).toBe(DOCUMENT_UNAVAILABLE_MESSAGE);
        expect(en.tableErrors.allRowsFailed).toBe(ALL_ROWS_FAILED_MESSAGE);
        expect(rowErrorText(DOCUMENT_UNAVAILABLE_MESSAGE, "zh-CN")).toBe("该文件已不可用。");
        expect(tableErrorText(ALL_ROWS_FAILED_MESSAGE, "zh-CN")).toBe("所有文件都未能读取。");
        expect(rowErrorText("This file could not be read: ECONNRESET", "en")).toBe(
            "This file could not be read."
        );
        expect(rowErrorText(null)).toBeNull();
    });
});
