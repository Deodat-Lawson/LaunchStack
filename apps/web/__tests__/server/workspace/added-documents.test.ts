/**
 * A file someone adds gets ADR-014's creation defaults and one feed entry —
 * only when the request actually inserted it. A retried upload that converged
 * on an earlier row must not make a file someone has since shared private
 * again, or announce it twice.
 */

import { recordUpload } from "~/server/workspace/added-documents";
import { recordActivity } from "~/server/workspace/activity";
import { applyDocumentCreationDefaults } from "~/server/workspace/ownership";

jest.mock("~/server/db", () => ({ db: jest.requireActual("../../helpers/fake-db").fakeDb.db }));
jest.mock("~/server/workspace/ownership", () => ({ applyDocumentCreationDefaults: jest.fn() }));
jest.mock("~/server/workspace/activity", () => ({ recordActivity: jest.fn() }));

const ADA = { companyId: BigInt(5), userPk: BigInt(7), authUserId: "ada" };

beforeEach(() => jest.clearAllMocks());

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
        await recordUpload(ADA, {
            document: { id: 20, title: "Plan.pdf", category: "Sales" },
            createdDocuments: [],
        });

        expect(applyDocumentCreationDefaults).not.toHaveBeenCalled();
        expect(recordActivity).not.toHaveBeenCalled();
    });
});
