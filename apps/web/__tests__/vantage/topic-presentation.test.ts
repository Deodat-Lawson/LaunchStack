import type { DemoTopic } from "~/app/employer/tools/vantage/demo-contract";
import { topicPresentation } from "~/app/employer/tools/vantage/_lib/topic-presentation";
import snapshot from "../../src/app/dev/vantage-action-sample/captured-sample.json";

const topics = snapshot.data.state.report.topics as DemoTopic[];

describe("deterministic topic presentation", () => {
    it("separates the observed discrepancy from interpretation and proposed checks", () => {
        const view = topicPresentation(topics[0]!);
        expect(view.title).toBe("Reconcile QA and Operations deletion results");
        expect(view.issue).toContain("3/3");
        expect(view.issue).toContain("2/3");
        expect(view.issue).toContain("account lists may differ");
        expect(view.issue).not.toContain("could distinguish");
        expect(view.reason).toContain("could distinguish");
        expect(view.approach).toHaveLength(2);
        expect(view.approach[1]).toMatch(/^If accounts overlap but results differ, consider/);
        expect(view.decision).toBe(topics[0]!.decisionQuestion);
    });

    it("retains unreviewed policy and missing-record qualifiers without asserting nonoccurrence", () => {
        const view = topicPresentation(topics[1]!);
        expect(view.title).toBe("Confirm privacy authorization requirements");
        expect(view.issue).toContain("unreviewed profile calls for separate privacy approval");
        expect(view.issue).toContain("supplied sources do not establish a recorded decision");
        expect(view.issue).not.toMatch(
            /approval is absent|has not been approved|approval never happened/i
        );
        expect(view.reason).toContain("do not establish a current pending decision");
        expect(view.approach).toEqual([]);
    });

    it("does not infer captured facts from a reused title or ID", () => {
        const topic = structuredClone(topics[0]!);
        topic.facts = [
            { text: "QA reports 1 of 4 checks passed; this is not approval.", refs: [] },
        ];
        const view = topicPresentation(topic);
        expect(view.title).toBe(topic.title);
        expect(view.issue).toBe(topic.facts[0]!.text);
        expect(view.issue).not.toMatch(/3\/3|2\/3/);
        expect(view.approach).toEqual([]);
        expect(view.reason).toBe(topic.whyItMatters);
    });

    it("falls back when a captured fact is changed or supplemented", () => {
        for (const change of ["change", "add"] as const) {
            const topic = structuredClone(topics[0]!);
            if (change === "change")
                topic.facts[1]!.text = "Operations now reports all four accounts deleted.";
            else topic.facts.push({ text: "A later review records approval.", refs: [] });
            expect(topicPresentation(topic).issue).toBe(topic.facts[0]!.text);
            expect(topicPresentation(topic).approach).toEqual([]);
        }
    });

    it("keeps complete fallback facts including trailing negation and attribution", () => {
        const topic = structuredClone(topics[0]!);
        const fact = `${"The supplied report discusses deletion checks. ".repeat(12)}It does not record approval; whether approval occurred elsewhere is unknown.`;
        topic.facts = [{ text: fact, refs: [] }];
        expect(topicPresentation(topic).issue).toBe(fact);
    });

    it("does not turn suggestions or rationale into factual issues when no facts are supplied", () => {
        const topic = { ...topics[0]!, facts: [], proposedNextStep: "Approve pilot access." };
        expect(topicPresentation(topic).issue).toBe("No factual summary supplied.");
    });

    it("hides trivial repeated steps and redundant reasons and decision prompts", () => {
        const topic = {
            ...topics[0]!,
            title: "Reconcile samples",
            facts: [{ text: "The samples differ.", refs: [] }],
            proposedNextStep: "Reconcile samples.",
            whyItMatters: "The samples differ!",
            decisionQuestion: "Reconcile samples?",
        };
        expect(topicPresentation(topic)).toMatchObject({
            reason: null,
            approach: [],
            decision: null,
        });
    });

    it("retains changed reason text and never carries forward a different proposed procedure", () => {
        const topic = {
            ...topics[0]!,
            whyItMatters: "Whether this affects access remains unknown.",
            proposedNextStep: "Reconcile samples.",
        };
        expect(topicPresentation(topic).reason).toBe(topic.whyItMatters);
        expect(topicPresentation(topic).approach).toEqual([]);
    });

    it("does not mutate originals or evidence reference identity", () => {
        const topic = structuredClone(topics[0]!);
        const before = JSON.stringify(topic);
        const fact = topic.facts[0]!;
        const refs = fact.refs;
        const ref = refs[0];
        topicPresentation(topic);
        expect(JSON.stringify(topic)).toBe(before);
        expect(topic.facts[0]).toBe(fact);
        expect(fact.refs).toBe(refs);
        expect(fact.refs[0]).toBe(ref);
    });
});
