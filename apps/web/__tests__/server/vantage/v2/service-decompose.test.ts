jest.mock("~/server/vantage/weekly-review-service", () => ({
    weeklyReviewDatabase: {},
    weeklyReviewServices: jest.fn(),
}));
jest.mock("~/server/vantage/v2/repository", () => ({
    createVantageV2Repository: jest.fn(() => ({ get: jest.fn(), create: jest.fn() })),
}));
jest.mock("~/server/vantage/v2/settings", () => ({
    getVantageV2Settings: jest.fn(),
}));
jest.mock("~/server/vantage/v2/model-journal", () => ({
    generateVantageV2Tasks: jest.fn(),
}));

import { weeklyReviewServices } from "~/server/vantage/weekly-review-service";
import { getVantageV2Settings } from "~/server/vantage/v2/settings";
import { generateVantageV2Tasks } from "~/server/vantage/v2/model-journal";
import { createVantageV2Plan, vantageV2Repository } from "~/server/vantage/v2/service";

test("decomposition receives only selected active company personas with their roles", async () => {
    const actor = { companyId: "1", userId: "owner" };
    jest.mocked(vantageV2Repository.get).mockResolvedValue({ plan: null });
    jest.mocked(weeklyReviewServices).mockReturnValue({
        repository: {
            get: jest.fn(async () => ({
                report: { topics: [{ id: "topic" }] },
                evidence: { inputSnapshot: { sources: [] } },
            })),
        },
    } as unknown as ReturnType<typeof weeklyReviewServices>);
    jest.mocked(getVantageV2Settings).mockResolvedValue({
        goals: [],
        personaIds: ["selected", "archived"],
        personas: [
            { id: "selected", name: "Analyst", role: "Compare operational risks" },
            { id: "unselected", name: "Writer", role: "Draft reports" },
        ],
    });
    jest.mocked(generateVantageV2Tasks).mockResolvedValue(
        JSON.stringify([
            {
                topicId: "topic",
                title: "Compare risks",
                description: "Compare the frozen evidence.",
                acceptanceCriterion: "A cited comparison.",
                priority: "medium",
                assigneeType: "persona",
                assigneeId: "selected",
                refs: [],
                workType: "comparison",
            },
        ])
    );
    await createVantageV2Plan(actor, "review");
    const content = jest.mocked(generateVantageV2Tasks).mock.calls[0]?.[2][0]?.content;
    if (typeof content !== "string") throw new Error("Expected a text decomposition prompt");
    const prompt = JSON.parse(content);
    expect(prompt.personas).toEqual([
        { id: "selected", name: "Analyst", role: "Compare operational risks" },
    ]);
    expect(vantageV2Repository.create).toHaveBeenCalledWith(
        actor,
        "review",
        expect.objectContaining({
            tasks: [expect.objectContaining({ assigneeType: "persona", assigneeId: "selected" })],
        })
    );
});
