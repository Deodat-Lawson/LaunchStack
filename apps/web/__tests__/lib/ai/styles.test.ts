/**
 * Answer styles. The ids an agent or the `chat.responseStyle` setting may
 * name are the prompts that exist, and length follows the question: no style
 * caps an answer at a word count.
 */

import { AGENT_STYLE_IDS } from "~/lib/agents/definition";
import { DEFAULT_STYLE, RESPONSE_STYLES } from "~/lib/ai/styles";
import { getSetting } from "~/lib/settings/registry";
import { QuestionSchema } from "~/lib/validation";

describe("answer styles", () => {
    it("has a prompt for every style an agent or the setting can name", () => {
        expect(Object.keys(RESPONSE_STYLES).sort()).toEqual([...AGENT_STYLE_IDS].sort());
    });

    it("defaults to balanced, in the product and in the setting", () => {
        expect(DEFAULT_STYLE).toBe("balanced");
        expect(getSetting("chat.responseStyle")?.default).toBe(DEFAULT_STYLE);
    });

    it.each(Object.values(RESPONSE_STYLES))("$id sets no word limit", style => {
        expect(style.systemPrompt).not.toMatch(/\b\d+\s+words\b/i);
    });

    it("leaves a question's style unset unless the request names one", () => {
        expect(QuestionSchema.parse({ question: "hi" }).style).toBeUndefined();
        expect(QuestionSchema.parse({ question: "hi", style: "concise" }).style).toBe("concise");
        expect(QuestionSchema.parse({ question: "hi", style: "organized" }).style).toBe(
            "organized"
        );
    });
});
