import { decomposeReview, validateTaskProposals } from "~/server/vantage/v2/decompose";
import type { ReadWeeklyReview } from "~/server/vantage/weekly-review-repository";
const review = {
    report: { topics: [{ id: "topic-1" }, { id: "topic-2" }, { id: "topic-3" }] },
    evidence: { inputSnapshot: { sources: [{ ref: "exact-version-hash" }] } },
} as unknown as ReadWeeklyReview;
const task = {
    topicId: "topic-1",
    title: "Check",
    description: "Compare next steps",
    acceptanceCriterion: "Provide a comparison",
    priority: "medium",
    assigneeType: "owner",
    assigneeId: "owner",
    refs: [],
};
it("keeps uncited actions visibly proposed and rejects invented exact refs", () => {
    const result = validateTaskProposals(
        [task, { ...task, refs: ["exact-version-hash"] }, { ...task, refs: ["invented"] }],
        review,
        "owner",
        []
    );
    expect(result.tasks.map(t => t.provenance)).toEqual(["proposal", "grounded"]);
    expect(result.discarded).toEqual([{ reason: "task_reference_invalid" }]);
});
it("rejects other topics and unselected personas or humans", () => {
    const result = validateTaskProposals(
        [
            { ...task, topicId: "other" },
            { ...task, assigneeType: "persona", assigneeId: "not-selected" },
            { ...task, assigneeId: "colleague" },
        ],
        review,
        "owner",
        []
    );
    expect(result.tasks).toHaveLength(0);
    expect(result.discarded.map(d => d.reason)).toEqual([
        "task_topic_invalid",
        "task_assignee_invalid",
        "task_assignee_invalid",
    ]);
});
it("bounds each topic and the full conceptual tree", () => {
    const tasks = [
        ...Array(4).fill(task),
        ...Array(4).fill({ ...task, topicId: "topic-2" }),
        ...Array(4).fill({ ...task, topicId: "topic-3" }),
    ];
    const result = validateTaskProposals(tasks, review, "owner", []);
    expect(result.tasks).toHaveLength(11);
    expect(result.tasks.length + review.report.topics.length + 1).toBe(15);
    expect(validateTaskProposals(Array(5).fill(task), review, "owner", []).tasks).toHaveLength(4);
});
it("repairs exactly once and discards still invalid output", async () => {
    const model = jest.fn().mockResolvedValue(JSON.stringify([{ ...task, refs: ["forged"] }]));
    const result = await decomposeReview(review, "owner", [], [], model);
    expect(model).toHaveBeenCalledTimes(2);
    expect(result.tasks).toHaveLength(0);
    expect(result.discarded[0]?.reason).toBe("task_reference_invalid");
});
it("uses a valid repair without a third model call", async () => {
    const model = jest
        .fn()
        .mockResolvedValueOnce("not JSON")
        .mockResolvedValueOnce(JSON.stringify([task]));
    const result = await decomposeReview(review, "owner", [], [], model);
    expect(model).toHaveBeenCalledTimes(2);
    expect(result.tasks).toHaveLength(1);
});

it("propagates provider or authority failure without a repair call", async () => {
    const model = jest.fn().mockRejectedValue(Error("authority_revoked"));
    await expect(decomposeReview(review, "owner", [], [], model)).rejects.toThrow(
        "authority_revoked"
    );
    expect(model).toHaveBeenCalledTimes(1);
});
