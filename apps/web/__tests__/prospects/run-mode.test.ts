import { resetChatEndpointWarnings } from "~/server/chat-endpoint";
import {
    describeRunMode,
    pickRunMode,
    readRunEnvironment,
    type RunMode,
} from "~/server/prospects/run-mode";

type Env = Record<string, string>;

describe("run mode", () => {
    // Reading the model resolves the chat endpoint, which warns once per process
    // when nothing names one. Reset so each case starts clean, and keep it quiet.
    beforeEach(() => {
        resetChatEndpointWarnings();
        jest.spyOn(console, "warn").mockImplementation(() => undefined);
    });
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("reads search availability from the environment", () => {
        expect(readRunEnvironment({})).toEqual({ hasModel: false, hasSearch: false });
        expect(readRunEnvironment({ EXA_API_KEY: "y" }).hasSearch).toBe(true);
        expect(readRunEnvironment({ SERPER_API_KEY: "y" }).hasSearch).toBe(true);
        expect(readRunEnvironment({ FOURSQUARE_SERVICE_KEY: "z" }).hasSearch).toBe(true);
    });

    // The model is whatever chat talks to: same resolution, no key list of its own.
    const modelCases: Array<[label: string, env: Env, hasModel: boolean]> = [
        ["nothing set", {}, false],
        ["only the Gemini key", { GOOGLE_AI_API_KEY: "g" }, true],
        [
            "the Gemini key beside the empty strings Compose passes for unset variables",
            { CHAT_BASE_URL: "", CHAT_API_KEY: "", AI_BASE_URL: "", GOOGLE_AI_API_KEY: "g" },
            true,
        ],
        ["a blank Gemini key", { GOOGLE_AI_API_KEY: "  " }, false],
        [
            "CHAT_BASE_URL and CHAT_API_KEY",
            { CHAT_BASE_URL: "https://llm.example/v1", CHAT_API_KEY: "k" },
            true,
        ],
        [
            "CHAT_BASE_URL alone, a keyless local endpoint",
            { CHAT_BASE_URL: "http://localhost:11434/v1" },
            true,
        ],
        ["CHAT_API_KEY alone, which names no endpoint", { CHAT_API_KEY: "k" }, false],
        [
            "the deprecated AI_BASE_URL and AI_API_KEY",
            { AI_BASE_URL: "https://llm.example/v1", AI_API_KEY: "k" },
            true,
        ],
        ["AI_API_KEY alone", { AI_API_KEY: "k" }, false],
        ["another vendor's key alone, which chat never uses", { OPENAI_API_KEY: "k" }, false],
    ];
    it.each(modelCases)("hasModel with %s", (_label, env, hasModel) => {
        expect(readRunEnvironment(env).hasModel).toBe(hasModel);
    });

    const gemini: Env = { GOOGLE_AI_API_KEY: "g" };
    const endpoint: Env = { CHAT_BASE_URL: "https://llm.example/v1", CHAT_API_KEY: "k" };
    const autoCases: Array<[label: string, env: Env, mode: RunMode]> = [
        ["neither a model nor a search key", {}, "keyless"],
        ["a Gemini key and no search key", gemini, "keyless"],
        ["a CHAT_BASE_URL endpoint and no search key", endpoint, "keyless"],
        ["a search key and no model", { EXA_API_KEY: "e" }, "keyless"],
        [
            "a bare vendor key and a search key",
            { OPENAI_API_KEY: "k", EXA_API_KEY: "e" },
            "keyless",
        ],
        ["a Gemini key and Exa", { ...gemini, EXA_API_KEY: "e" }, "live"],
        ["a Gemini key and Serper", { ...gemini, SERPER_API_KEY: "s" }, "live"],
        [
            "a CHAT_BASE_URL endpoint and Foursquare",
            { ...endpoint, FOURSQUARE_SERVICE_KEY: "f" },
            "live",
        ],
    ];
    it.each(autoCases)("auto with %s", (_label, env, mode) => {
        expect(pickRunMode("auto", readRunEnvironment(env))).toBe(mode);
    });

    it("falls back to keyless whenever a fresh dev environment lacks keys", () => {
        expect(pickRunMode("auto", { hasModel: false, hasSearch: false })).toBe("keyless");
        expect(pickRunMode("auto", { hasModel: true, hasSearch: false })).toBe("keyless");
        expect(pickRunMode("auto", { hasModel: false, hasSearch: true })).toBe("keyless");
        expect(pickRunMode("auto", { hasModel: true, hasSearch: true })).toBe("live");
        expect(pickRunMode("sample", { hasModel: true, hasSearch: true })).toBe("fixture");
        expect(pickRunMode("keyless", { hasModel: true, hasSearch: true })).toBe("keyless");
        expect(describeRunMode("keyless")).toBe("public sources, no keys");
    });
});
