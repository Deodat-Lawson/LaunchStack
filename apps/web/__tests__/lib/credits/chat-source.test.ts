/**
 * Chat on a workspace's own endpoint spends no LaunchStack credits: the
 * workspace's provider bills those tokens. Chat on the deployment's models is
 * debited as before. The AI chat route reads the source where it resolves the
 * model, inside the workspace scope, so this checks that reading too.
 */
import { getChatModelsSource, runWithChatModelsScope } from "@launchstack/llm";

import { shouldDebitChatTokens } from "~/lib/credits/chat-source";

describe("shouldDebitChatTokens", () => {
    it("debits chat on the deployment's models", () => {
        expect(shouldDebitChatTokens("deployment")).toBe(true);
    });

    it("never debits chat on the workspace's own endpoint", () => {
        expect(shouldDebitChatTokens("workspace")).toBe(false);
    });

    it("debits work outside any workspace scope", () => {
        expect(shouldDebitChatTokens(getChatModelsSource())).toBe(true);
    });

    it("follows the scope the model was resolved in", () => {
        const inWorkspace = runWithChatModelsScope({ source: "workspace" }, () =>
            shouldDebitChatTokens(getChatModelsSource())
        );
        const pinnedToDeployment = runWithChatModelsScope({ source: "deployment" }, () =>
            shouldDebitChatTokens(getChatModelsSource())
        );
        expect(inWorkspace).toBe(false);
        expect(pinnedToDeployment).toBe(true);
    });
});
