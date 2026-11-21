import {
    PersonalTopicInput,
    listPersonalTopics,
} from "../../src/server/vantage/weekly-review-personal-topics";

const input = {
    title: "Release decision",
    openQuestions: ["Is rollback ready?"],
    decisionChangers: [],
    keywords: [],
    people: [],
    metrics: [],
    status: "active",
    watches: ["1"],
};
test("guidance and watches are strictly bounded", () => {
    expect(PersonalTopicInput.safeParse(input).success).toBe(true);
    expect(
        PersonalTopicInput.safeParse({ ...input, openQuestions: Array(9).fill("question") }).success
    ).toBe(false);
    expect(PersonalTopicInput.safeParse({ ...input, ownerId: "another-user" }).success).toBe(false);
    expect(PersonalTopicInput.safeParse({ ...input, watches: ["-1"] }).success).toBe(false);
});
test("reader scopes every query to the owner and hides denied watches", async () => {
    const query = jest
        .fn()
        .mockResolvedValueOnce([
            {
                id: "topic",
                title: input.title,
                guidance: {
                    openQuestions: input.openQuestions,
                    decisionChangers: [],
                    keywords: [],
                    people: [],
                    metrics: [],
                },
                status: "active",
                revision: 2,
            },
        ])
        .mockResolvedValueOnce([
            { topic_id: "topic", document_id: 1 },
            { topic_id: "topic", document_id: 99 },
        ]);
    const result = await listPersonalTopics(
        query,
        { companyId: "5", userId: "owner" },
        new Set(["1"])
    );
    expect(result[0]?.watches).toEqual(["1"]);
    for (const call of query.mock.calls) expect(call[1]).toEqual(["5", "owner"]);
});
