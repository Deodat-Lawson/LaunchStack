/**
 * A file someone adds gets ADR-014's creation defaults and one feed entry —
 * only when the request actually inserted it. A retried upload that converged
 * on an earlier row must not make a file someone has since shared private
 * again, or announce it twice.
 */

import { document } from "@launchstack/store/schema";
import { documentGrants, documentSettings } from "~/server/db/schema";
import { recordUpload } from "~/server/workspace/added-documents";

import { fakeDb } from "../../helpers/fake-db";
import { recordActivity } from "~/server/workspace/activity";
import { applyDocumentCreationDefaults } from "~/server/workspace/ownership";

jest.mock("~/server/db", () => ({ db: jest.requireActual("../../helpers/fake-db").fakeDb.db }));
jest.mock("~/server/workspace/ownership", () => ({ applyDocumentCreationDefaults: jest.fn() }));
jest.mock("~/server/workspace/activity", () => ({ recordActivity: jest.fn() }));

const ADA = { companyId: BigInt(5), userPk: BigInt(7), authUserId: "ada" };

beforeEach(() => {
    jest.clearAllMocks();
    fakeDb.reset();
});

describe("recordUpload", () => {
    it("gives every new row its defaults and announces the one the person added", async () => {
        const recording = { id: 20, title: "Standup.m4a", category: "" };
        const transcript = { id: 21, title: "Standup.m4a (Transcription)", category: "" };

        await recordUpload(ADA, {
            document: recording,
            createdDocuments: [recording, transcript],
        });

        expect(applyDocumentCreationDefaults).toHaveBeenCalledWith(
            expect.anything(),
            { companyId: BigInt(5), userPk: BigInt(7), authUserId: "ada" },
            [
                { id: 20, category: "" },
                { id: 21, category: "" },
            ]
        );
        expect(recordActivity).toHaveBeenCalledTimes(1);
        expect(recordActivity).toHaveBeenCalledWith(expect.anything(), {
            companyId: BigInt(5),
            actorUserId: "ada",
            verb: "added",
            targetType: "document",
            targetId: 20,
            targetLabel: "Standup.m4a",
            targetPath: "Unfiled",
        });
    });

    it("does nothing for a retry that converged on rows an earlier call made", async () => {
        // The earlier call finished: the file already has its owner's grant.
        fakeDb.onSelect(document, [{ createdAt: new Date() }]);
        fakeDb.onSelect(documentGrants, [{ id: 1 }]);
        await recordUpload(ADA, {
            document: { id: 20, title: "Plan.pdf", category: "Sales" },
            createdDocuments: [],
        });

        expect(applyDocumentCreationDefaults).not.toHaveBeenCalled();
        expect(recordActivity).not.toHaveBeenCalled();
    });

    it("finishes the defaults when the earlier attempt died before they landed", async () => {
        fakeDb.onSelect(document, [{ createdAt: new Date() }]);
        fakeDb.onSelect(documentGrants, []);
        fakeDb.onSelect(documentSettings, []);

        await recordUpload(ADA, {
            document: { id: 20, title: "Plan.pdf", category: "" },
            createdDocuments: [],
        });

        expect(applyDocumentCreationDefaults).toHaveBeenCalledWith(expect.anything(), ADA, [
            { id: 20, category: "" },
        ]);
    });

    it("never makes an old, pre-ADR-014 file private on a converged retry", async () => {
        fakeDb.onSelect(document, [{ createdAt: new Date(Date.now() - 86_400_000) }]);
        fakeDb.onSelect(documentGrants, []);
        fakeDb.onSelect(documentSettings, []);

        await recordUpload(ADA, {
            document: { id: 20, title: "Plan.pdf", category: "" },
            createdDocuments: [],
        });

        expect(applyDocumentCreationDefaults).not.toHaveBeenCalled();
    });
});
