/**
 * "Generate with AI" asks the workspace's model for a diagram as text. For a
 * flowchart that text is the step language — the one the editor's Steps
 * panel and the agent tools speak — with Mermaid still accepted; what comes
 * back is read by what it is, and a flowchart the parser cannot read is sent
 * back once with the reason. The model call is mocked.
 */
import type { BaseMessage } from "@langchain/core/messages";

import { invokeStructuredWithUsage } from "@launchstack/llm";
import { STEPS_LANGUAGE } from "~/app/employer/documents/_mindmap/model/agent-edits";
import { activePage } from "~/app/employer/documents/_mindmap/model/doc";
import { flowchartToSteps } from "~/app/employer/documents/_mindmap/model/flowchart";
import { buildDiagram, type DiagramType } from "~/app/employer/documents/_mindmap/model/generate";
import { generateDiagramSpec, toSpec } from "~/server/mindmap/generate";

jest.mock("@launchstack/llm", () => ({ invokeStructuredWithUsage: jest.fn() }));
jest.mock("~/lib/models", () => ({ resolveConfiguredChatModel: jest.fn(() => ({})) }));

const STEPS = [
    "Start",
    "Request a refund",
    "Within 30 days?",
    "  Yes: Refund the card",
    "  No: Ask a manager -> Request a refund",
    "End",
].join("\n");

type Answer = {
    title: string;
    type: DiagramType;
    outline: string;
    steps: string;
    mermaid: string;
};

function answer(fields: Partial<Answer>): { result: Answer } {
    return {
        result: {
            title: "Refunds",
            type: "flowchart",
            outline: "",
            steps: "",
            mermaid: "",
            ...fields,
        },
    };
}

const invoke = jest.mocked(invokeStructuredWithUsage);
const messagesOf = (call: number) => invoke.mock.calls[call]![2] as BaseMessage[];
const text = (m: BaseMessage) => String(m.content);

beforeEach(() => invoke.mockReset());

describe("generateDiagramSpec", () => {
    it("asks for a flowchart as step text, with the language and its example", async () => {
        invoke.mockResolvedValueOnce(answer({ steps: STEPS }) as never);
        const spec = await generateDiagramSpec("How refunds work", "flowchart");
        const system = text(messagesOf(0)[0]!);
        expect(system).toContain("For flowchart, write `steps`");
        expect(system).toContain(STEPS_LANGUAGE);
        expect(system).toContain("Only for a flowchart that needs groups");
        expect(spec).toMatchObject({ type: "flowchart", steps: STEPS });
        const doc = buildDiagram(spec);
        expect(doc.settings.flowLayout).toBe("auto");
        expect(flowchartToSteps(activePage(doc)).text).toBe(STEPS);
    });

    it("sends steps it cannot read back once, with the reason, and takes the fix", async () => {
        invoke
            .mockResolvedValueOnce(answer({ steps: "Start\nPack -> Nowhere\nEnd" }) as never)
            .mockResolvedValueOnce(answer({ steps: STEPS }) as never);
        const spec = await generateDiagramSpec("How refunds work");
        expect(invoke).toHaveBeenCalledTimes(2);
        const retry = text(messagesOf(1)[1]!);
        expect(retry).toContain("Your last answer could not be drawn");
        expect(retry).toContain('"-> Nowhere" points at no step');
        expect(spec.steps).toBe(STEPS);
    });

    it("still takes Mermaid for a flowchart", async () => {
        invoke.mockResolvedValueOnce(
            answer({
                mermaid: "flowchart LR\n A[Order] --> B{Paid?}\n B -->|yes| C[Ship]",
            }) as never
        );
        const spec = await generateDiagramSpec("Orders");
        expect(activePage(buildDiagram(spec)).nodes).toHaveLength(3);
    });
});

describe("toSpec", () => {
    it("reads a model's answer by what it wrote", () => {
        expect(toSpec(answer({ type: "flowchart", outline: "- A\n  - B" }).result).type).toBe(
            "mindmap"
        );
        expect(toSpec(answer({ type: "mindmap", steps: "A\nB" }).result).type).toBe("flowchart");
    });
});
