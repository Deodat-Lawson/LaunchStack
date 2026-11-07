jest.mock("~/lib/storage", () => ({ uploadFile: jest.fn() }));
jest.mock("~/server/services/document-upload", () => ({ processDocumentUpload: jest.fn() }));
jest.mock("~/server/prospects/matching", () => ({
    prospectEmbedder: jest.fn(),
    prospectFitJudge: jest.fn(),
}));
jest.mock("~/server/workspace-models/scope", () => ({ withWorkspaceChatModels: jest.fn() }));
jest.mock("@launchstack/pipelines/distribution", () => ({}));
jest.mock("@launchstack/pipelines/distribution/db", () => ({}));

import { readProspectsExecutor } from "~/server/prospects/keyless-run";

describe("where a keyless run executes", () => {
    it("runs in the web process unless the deployment attached the worker", () => {
        expect(readProspectsExecutor({})).toBe("inline");
        expect(readProspectsExecutor({ PROSPECTS_EXECUTOR: "inline" })).toBe("inline");
        expect(readProspectsExecutor({ PROSPECTS_EXECUTOR: " Worker " })).toBe("worker");
    });
});
