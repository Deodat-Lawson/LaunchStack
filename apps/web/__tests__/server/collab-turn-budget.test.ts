/**
 * A meeting turn's model budget. Real meetings on the default route came back
 * cut off after one or two sentences: the model thought at its own default
 * effort inside an 800-token cap that counted the thinking. A turn now asks for
 * low effort and keeps room for the reply, and a reply that still hits the cap
 * is posted up to its last full sentence.
 */

import { getChatModelPreset, type ChatModelBehavior } from "@launchstack/llm";

const resolveCalls: Record<string, unknown>[] = [];
const mockInvoke = jest.fn();
let mockBehavior: ChatModelBehavior;

jest.mock("~/lib/models", () => ({
    describeChatResolutionFailure: () => ({ status: 500, message: "misconfigured" }),
    resolveConfiguredChatModel: (options: Record<string, unknown>) => {
        resolveCalls.push(options);
        return {
            route: options.route,
            modelId: "vendor/model",
            behavior: mockBehavior,
            chat: { invoke: mockInvoke },
            prepareMessages: (messages: unknown[]) => messages,
        };
    },
}));

import { createCollabChatFn } from "~/server/collab/chat";
import { MEETING_TURN_MAX_OUTPUT_TOKENS, meetingTurnReasoning } from "~/server/collab/turn-budget";

const GEMINI = getChatModelPreset("google/gemini-3.8-flash")!.behavior;
const turn = { messages: [{ role: "user" as const, content: "Your turn." }] };

function effortModel(levels: string[]): ChatModelBehavior {
    return {
        ...GEMINI,
        reasoning: {
            mode: "effort",
            levels: Object.fromEntries(levels.map(level => [level, { reasoning_effort: level }])),
            default: levels.at(-1)!,
        },
    };
}

beforeEach(() => {
    resolveCalls.length = 0;
    mockInvoke.mockReset();
    mockBehavior = GEMINI;
    jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("meetingTurnReasoning", () => {
    it("asks an effort model for low, then minimal, and never for none", () => {
        expect(meetingTurnReasoning(GEMINI)).toEqual({ enabled: true, effort: "low" });
        expect(meetingTurnReasoning(effortModel(["minimal", "high"]))).toEqual({
            enabled: true,
            effort: "minimal",
        });
        expect(meetingTurnReasoning(effortModel(["none", "high"]))).toBeUndefined();
    });

    it("gives a budget model a small budget inside its bounds", () => {
        const budget = (min: number, max: number): ChatModelBehavior => ({
            ...GEMINI,
            reasoning: { mode: "budget", field: "thinking_budget", default: 8192, min, max },
        });
        expect(meetingTurnReasoning(budget(0, 24576))).toEqual({
            enabled: true,
            budgetTokens: 1024,
        });
        expect(meetingTurnReasoning(budget(2048, 24576))).toEqual({
            enabled: true,
            budgetTokens: 2048,
        });
    });

    it("leaves models with nothing to choose alone", () => {
        expect(meetingTurnReasoning({ ...GEMINI, reasoning: { mode: "none" } })).toBeUndefined();
        expect(meetingTurnReasoning({ ...GEMINI, reasoning: { mode: "always" } })).toBeUndefined();
        expect(
            meetingTurnReasoning({ ...GEMINI, reasoning: { mode: "toggle", on: { think: true } } })
        ).toBeUndefined();
    });
});

describe("createCollabChatFn", () => {
    it("asks the route's model for low effort with room for a full reply", async () => {
        mockInvoke.mockResolvedValue({ content: "Margin recovers to 44%." });
        await expect(createCollabChatFn()({ ...turn, route: "reasoning" })).resolves.toBe(
            "Margin recovers to 44%."
        );
        expect(resolveCalls.at(-1)).toMatchObject({
            route: "reasoning",
            maxOutputTokens: MEETING_TURN_MAX_OUTPUT_TOKENS,
            reasoningControl: { enabled: true, effort: "low" },
        });
        expect(MEETING_TURN_MAX_OUTPUT_TOKENS).toBeGreaterThanOrEqual(2400);
    });

    it("sends no reasoning request to a model that cannot take one", async () => {
        mockBehavior = { ...GEMINI, reasoning: { mode: "none" } };
        mockInvoke.mockResolvedValue({ content: "Two sprints." });
        await createCollabChatFn()(turn);
        expect(resolveCalls).toHaveLength(1);
        expect(resolveCalls[0]).not.toHaveProperty("reasoningControl");
    });

    it("posts a reply the cap cut off up to its last full sentence", async () => {
        mockInvoke.mockResolvedValue({
            content: "Margin recovers to 44% within a quarter. The billing migration needs two spr",
            response_metadata: { finish_reason: "length" },
        });
        await expect(createCollabChatFn()(turn)).resolves.toBe(
            "Margin recovers to 44% within a quarter."
        );
    });

    it("says so when the cap was spent before any answer", async () => {
        mockInvoke.mockResolvedValue({
            content: "",
            response_metadata: { finish_reason: "length" },
        });
        await expect(createCollabChatFn()(turn)).rejects.toThrow(
            "The default model used up its turn before answering"
        );
    });

    it("keeps a complete reply as it is", async () => {
        const content = "Owners:\n- finance: rollout\n- engineer: metering";
        mockInvoke.mockResolvedValue({ content, response_metadata: { finish_reason: "stop" } });
        await expect(createCollabChatFn()(turn)).resolves.toBe(content);
    });
});
