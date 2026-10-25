/**
 * The Drive sink's blob upload. With the database storage backend the
 * upload becomes a `file_uploads` row, and `/api/files/[id]` denies every
 * session read of a row with no company stamp — so a synced file nobody
 * stamped could only ever be read by the OCR worker.
 */

jest.mock("~/env", () => ({ env: { server: { APP_PUBLIC_URL: undefined } } }));
jest.mock("~/server/engine", () => ({ getEngine: jest.fn() }));
jest.mock("~/lib/storage", () => ({ uploadFile: jest.fn() }));
jest.mock("@launchstack/llm/embeddings", () => ({ resolveIngestIndexKey: jest.fn() }));
jest.mock("~/server/services/document-creation", () => ({
    createDocumentLifecycle: jest.fn(),
    createDocumentVersionLifecycle: jest.fn(),
    findDocumentByCreationKey: jest.fn(),
}));
jest.mock("~/server/workspace/ownership", () => ({ applyDocumentCreationDefaults: jest.fn() }));

const mockUpdateWhere = jest.fn();
jest.mock("~/server/db", () => ({
    db: { update: () => ({ set: () => ({ where: mockUpdateWhere }) }) },
}));

import type { KnowledgeItem } from "@launchstack/pipelines/connectors";
import { resolveIngestIndexKey } from "@launchstack/llm/embeddings";

import { uploadFile } from "~/lib/storage";
import {
    createDocumentLifecycle,
    createDocumentVersionLifecycle,
    findDocumentByCreationKey,
} from "~/server/services/document-creation";
import { createGoogleDriveSink } from "~/server/services/connectors/google-drive/sink";

const mockUploadFile = uploadFile as jest.Mock;

function driveItem(): KnowledgeItem {
    return {
        sourceId: "drive-file-1",
        connectorId: "google-drive",
        title: "Quarterly plan",
        kind: "google-doc",
        mimeType: "text/markdown",
        bytes: 12,
        modifiedAt: "2026-10-01T00:00:00.000Z",
        location: { origin: "https://drive.google.com/file/d/1", relativePath: "Quarterly plan" },
        metadata: {
            driveFileId: "1",
            driveMimeType: "application/vnd.google-apps.document",
            extension: ".md",
        },
        content: "# Plan",
        contentHash: "rev-2",
    };
}

const context = { companyId: 7n, connectionId: 3, userId: "user_abc" };

beforeEach(() => {
    jest.clearAllMocks();
    (resolveIngestIndexKey as jest.Mock).mockResolvedValue("openai-small");
    mockUploadFile.mockResolvedValue({ url: "https://blob.test/plan.md" });
    (findDocumentByCreationKey as jest.Mock).mockResolvedValue(null);
    (createDocumentLifecycle as jest.Mock).mockResolvedValue({
        documentId: 11,
        versionId: 21,
        jobId: "job-1",
        created: true,
    });
    (createDocumentVersionLifecycle as jest.Mock).mockResolvedValue({
        documentId: 11,
        versionId: 22,
        jobId: "job-2",
    });
});

describe("createGoogleDriveSink — upload stamp", () => {
    it("stamps the workspace on a first-sync upload", async () => {
        const sink = await createGoogleDriveSink(context);
        await sink.store(driveItem());

        expect(mockUploadFile).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "user_abc", companyId: 7n })
        );
    });

    it("stamps the workspace when the upload is attributed to the folder's importer", async () => {
        const sink = await createGoogleDriveSink({
            ...context,
            place: () =>
                Promise.resolve({
                    category: "Private/importer",
                    owner: { companyId: 7n, userPk: 5n, authUserId: "user_importer" },
                }),
        });
        await sink.store(driveItem());

        expect(mockUploadFile).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "user_importer", companyId: 7n })
        );
    });

    it("stamps the workspace on a revision's upload", async () => {
        (findDocumentByCreationKey as jest.Mock).mockResolvedValue({
            id: 11,
            category: "Google Drive",
            ocrMetadata: { contentHash: "rev-1" },
        });

        const sink = await createGoogleDriveSink(context);
        const result = await sink.store(driveItem());

        expect(result.revised).toBe(true);
        expect(mockUploadFile).toHaveBeenCalledWith(expect.objectContaining({ companyId: 7n }));
    });
});
