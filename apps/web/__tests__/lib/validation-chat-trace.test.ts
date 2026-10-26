/**
 * A saved answer keeps its thinking trace: the steps it showed and how long
 * it thought. zod strips unknown keys, so a schema without these fields would
 * silently drop them and a reloaded chat would lose its "Thought for 4s".
 */

import { SessionMessageSchema } from "~/lib/validation";
import { MAX_TURN_STEPS } from "~/lib/chat-turns";

const STEP = {
    id: "search",
    label: "Found 5 passages in 1 source",
    detail: "Globex MSA 2026.pdf",
    state: "done" as const,
    startMs: 80,
    endMs: 930,
};

function turn(metadata: Record<string, unknown>) {
    return { role: "assistant" as const, text: "Answer.", metadata };
}

describe("SessionMessageSchema thinking trace", () => {
    it("round-trips steps and the first-word time", () => {
        const steps = [STEP, { id: "think", label: "Thinking", state: "active", startMs: 990 }];
        const parsed = SessionMessageSchema.parse(turn({ steps, thoughtMs: 3100 }));
        expect(parsed.metadata).toEqual({ steps, thoughtMs: 3100 });
    });

    it.each([
        ["too many steps", { steps: Array.from({ length: MAX_TURN_STEPS + 1 }, () => STEP) }],
        ["an unknown state", { steps: [{ ...STEP, state: "running" }] }],
        ["an empty id", { steps: [{ ...STEP, id: "" }] }],
        ["an oversized label", { steps: [{ ...STEP, label: "x".repeat(501) }] }],
        ["a negative time", { thoughtMs: -1 }],
    ])("rejects %s", (_label, metadata) => {
        expect(SessionMessageSchema.safeParse(turn(metadata)).success).toBe(false);
    });
});
