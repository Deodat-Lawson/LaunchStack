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
const personas = [
    { id: "analyst", name: "Risk analyst", role: "Analyze release risks and compare evidence" },
    { id: "writer", name: "Writer", role: "Draft concise operating documents" },
];
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
it("keeps read-only analysis with a selected persona and human actions with the owner", () => {
    const result = validateTaskProposals(
        [
            { ...task, workType: "analysis", assigneeType: "persona", assigneeId: "analyst" },
            {
                ...task,
                title: "Obtain rollback owner acceptance",
                description: "Contact the release lead and obtain explicit acceptance.",
                acceptanceCriterion: "A named person has accepted ownership.",
                workType: "human_action",
                assigneeType: "persona",
                assigneeId: "analyst",
            },
        ],
        review,
        "owner",
        personas
    );
    expect(result.tasks.map(t => [t.assigneeType, t.assigneeId])).toEqual([
        ["persona", "analyst"],
        ["owner", "owner"],
    ]);
    expect(result.tasks.map(t => t.workType)).toEqual(["analysis", "human_action"]);
    expect(result.discarded).toEqual([]);
});
it("rejects unspecified or unsupported capabilities for persona work", () => {
    const result = validateTaskProposals(
        [
            { ...task, assigneeType: "persona", assigneeId: "analyst" },
            {
                ...task,
                workType: "send_message",
                assigneeType: "persona",
                assigneeId: "analyst",
            },
        ],
        review,
        "owner",
        personas
    );
    expect(result.tasks).toHaveLength(0);
    expect(result.discarded).toEqual([
        { reason: "task_capability_unspecified" },
        { reason: "task_shape_invalid" },
    ]);
});
it("supplies selected persona roles and read-only capabilities for role-based assignments", async () => {
    const model = jest.fn(async (text: string) => {
        const prompt = JSON.parse(text);
        expect(prompt.personas).toEqual(personas);
        expect(prompt.agentCapability).toContain("read the accepted brief and its frozen excerpts");
        expect(prompt.agentCapability).toContain("matching its role");
        expect(prompt.agentCapability).toContain("human_action");
        expect(prompt.instruction).toContain("There is no minimum task count");
        return JSON.stringify([
            {
                ...task,
                title: "Compare release risks",
                workType: "comparison",
                assigneeType: "persona",
                assigneeId: prompt.personas.find((p: { role: string }) =>
                    p.role.includes("release risks")
                ).id,
            },
            {
                ...task,
                title: "Draft a release decision memo",
                workType: "draft",
                assigneeType: "persona",
                assigneeId: "writer",
            },
            {
                ...task,
                title: "Approve release expansion",
                workType: "human_action",
                assigneeType: "owner",
                assigneeId: "owner",
            },
        ]);
    });
    const result = await decomposeReview(review, "owner", personas, [], model);
    expect(model).toHaveBeenCalledTimes(1);
    expect(result.tasks.map(t => t.assigneeId)).toEqual(["analyst", "writer", "owner"]);
    expect(result.tasks.map(t => t.workType)).toEqual(["comparison", "draft", "human_action"]);
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
