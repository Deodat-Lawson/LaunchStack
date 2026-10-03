import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { applyMessageBehavior } from "./messages";
import { getChatModelPreset } from "./presets";
import type { ChatModelBehavior } from "./types";

const base = getChatModelPreset("google/gemini-3.8-flash")!.behavior;
const noSystem: ChatModelBehavior = {
    ...base,
    parameters: { ...base.parameters, systemMessages: "unsupported" },
};

describe("applyMessageBehavior without system messages", () => {
    it("folds the system prompt into the first user turn verbatim", () => {
        const system = String.raw`Write inline math as \( x \). Keep (x^{2} + 1) as written.`;
        const messages = applyMessageBehavior(noSystem, [
            new SystemMessage(system),
            new HumanMessage("hi"),
        ]);

        expect(messages).toHaveLength(1);
        expect(messages[0]!.getType()).toBe("human");
        expect(messages[0]!.content).toBe(`${system}\n\nhi`);
    });

    it("sends the system prompt verbatim as a user turn when there is none", () => {
        const system = String.raw`Answer with \( x \) notation.`;
        const messages = applyMessageBehavior(noSystem, [new SystemMessage(system)]);

        expect(messages).toHaveLength(1);
        expect(messages[0]!.getType()).toBe("human");
        expect(messages[0]!.content).toBe(system);
    });
});
