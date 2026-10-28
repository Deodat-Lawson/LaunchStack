import type { CommitmentDto } from "~/app/employer/tools/vantage/api";
import type { DemoSourceRef } from "~/app/employer/tools/vantage/demo-contract";
import snapshot from "./captured-sample.json";
import { createItems, readableTitle, sourceKey, type SampleData } from "./sample-model";

const captured = snapshot.data as SampleData;

describe("captured Vantage sample adapter", () => {
    it("preserves separate proposals, historical questions and the empty actual commitment ledger", () => {
        const items = createItems(captured);
        expect(items.map(item => item.type)).toEqual(["proposal", "proposal", "question"]);
        expect(captured.commitments).toEqual([]);
        expect(new Set(items.map(item => item.id)).size).toBe(3);
        expect(items.every(item => item.owner === null && item.due === null)).toBe(true);
        expect(items.find(item => item.type === "question")?.status).toBe("unverified");
    });

    it("keeps source evidence byte-for-byte and does not fabricate exact versions for historical refs", () => {
        const items = createItems(captured);
        const historical = items.find(item => item.type === "question")!;
        expect(historical.refs).toEqual([]);
        expect(historical.legacyRefs).toEqual(captured.pending!.questions[0]!.sourceRefs);
        expect(historical.legacyRefs![0]).not.toHaveProperty("version");
        const sourceKeys = new Set(captured.sources.map(source => sourceKey(source.source)));
        for (const proposal of items.filter(item => item.type === "proposal")) {
            expect(proposal.refs.length).toBeGreaterThan(0);
            expect(proposal.refs.every(ref => sourceKeys.has(sourceKey(ref)))).toBe(true);
            expect(proposal.topic).toEqual(
                captured.state.report!.topics.find(topic => `proposal:${topic.id}` === proposal.id)
            );
        }
    });

    it("deduplicates an exact citation while retaining different versions of the same document", () => {
        const data = structuredClone(captured);
        const topic = data.state.report!.topics[0]!;
        const ref = topic.facts[0]!.refs[0]!;
        const changed: DemoSourceRef = { ...ref, version: `${ref.version}-other` };
        topic.conflicts.push({ text: "Different-version evidence", refs: [ref, changed] });
        const item = createItems(data)[0]!;
        expect(item.refs.filter(candidate => sourceKey(candidate) === sourceKey(ref))).toHaveLength(
            1
        );
        expect(item.refs.some(candidate => sourceKey(candidate) === sourceKey(changed))).toBe(true);
    });

    it("does not infer fulfillment from a kept topic, a human decision, or a suggested historical due date", () => {
        const data = structuredClone(captured);
        data.state.report!.topics[0]!.status = "kept";
        data.state.report!.topics[0]!.decision = {
            value: "go",
            recordedAt: "2026-10-28T00:00:00Z",
        };
        data.pending!.questions[0]!.suggestedDue = "2026-10-30";
        const items = createItems(data);
        expect(items.filter(item => item.type === "commitment")).toEqual([]);
        expect(items[0]!.status).toBe("kept");
        expect(items[0]!.due).toBeNull();
        expect(items.find(item => item.type === "question")!.due).toBeNull();
        expect(items[0]!.history.at(-1)!.label).toBe("Recorded human decision");
    });

    it("uses only an actual commitment's recorded owner, date, status and outcome", () => {
        const commitment: CommitmentDto = {
            id: "actual-action",
            agendaId: null,
            topicId: null,
            topicTitle: null,
            title: "Compare the two sample lists",
            owner: "Reviewer",
            dueOn: "2026-10-30",
            test: "Compare account IDs",
            status: "done",
            outcome: "Lists reconciled",
            shared: false,
            resolvedAt: "2026-10-28T12:00:00Z",
            createdAt: "2026-10-27T12:00:00Z",
        };
        const data = { ...captured, commitments: [commitment] };
        const action = createItems(data).find(item => item.type === "commitment")!;
        expect(action).toMatchObject({
            owner: "Reviewer",
            due: "2026-10-30",
            status: "done",
            commitment,
        });
        expect(action.refs).toEqual([]);
        expect(action.history.at(-1)).toMatchObject({
            detail: "Lists reconciled",
            at: commitment.resolvedAt,
        });
    });

    it("changes only presentation titles and leaves the captured data unchanged", () => {
        const before = JSON.stringify(captured);
        const items = createItems(captured);
        expect(items[0]!.title).toBe("Reconcile run-17 deletion checks");
        expect(items[0]!.originalTitle).toBe(captured.state.report!.topics[0]!.title);
        expect(readableTitle("  A different report title  ")).toBe("A different report title");
        expect(JSON.stringify(captured)).toBe(before);
    });
});
