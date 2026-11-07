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

    it("counts a workspace's own model where the server has none", () => {
        expect(readRunEnvironment({}, true, true)).toEqual({
            hasModel: true,
            hasSearch: true,
        });
        expect(pickRunMode("auto", readRunEnvironment({}, true, true))).toBe("live");
        expect(pickRunMode("auto", readRunEnvironment({}, false, true))).toBe("keyless");
    });

    it("counts the server's search engine, whichever it is, and Foursquare", () => {
        expect(readRunEnvironment({}, false, false)).toEqual({ hasModel: false, hasSearch: false });
        expect(readRunEnvironment({}, false, true).hasSearch).toBe(true);
        expect(readRunEnvironment({ FOURSQUARE_SERVICE_KEY: "z" }, false, false).hasSearch).toBe(
            true
        );
    });

    describe("asks the search layer by default", () => {
        const names = [
            "SEARCH_PROVIDER",
            "EXA_API_KEY",
            "SERPER_API_KEY",
            "BRAVE_SEARCH_API_KEY",
            "TAVILY_API_KEY",
            "SEARXNG_URL",
        ] as const;
        const saved: Partial<Record<(typeof names)[number], string>> = {};
        beforeEach(() => {
            for (const name of names) {
                saved[name] = process.env[name];
                delete process.env[name];
            }
        });
        afterEach(() => {
            for (const name of names) {
                if (saved[name] === undefined) delete process.env[name];
                else process.env[name] = saved[name];
            }
        });

        it.each([
            ["no engine", {}, false],
            ["SearXNG alone", { SEARXNG_URL: "http://searxng:8080" }, true],
            ["Brave alone", { BRAVE_SEARCH_API_KEY: "b" }, true],
            [
                "Serper chosen without its key",
                { SEARCH_PROVIDER: "serper", EXA_API_KEY: "e" },
                false,
            ],
        ] as const)("%s", (_label, vars, hasSearch) => {
            Object.assign(process.env, vars);
            expect(readRunEnvironment({}).hasSearch).toBe(hasSearch);
        });
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
    const autoCases: Array<[label: string, env: Env, search: boolean, mode: RunMode]> = [
        ["neither a model nor search", {}, false, "keyless"],
        ["a Gemini key and no search", gemini, false, "keyless"],
        ["a CHAT_BASE_URL endpoint and no search", endpoint, false, "keyless"],
        ["search and no model", {}, true, "keyless"],
        ["a bare vendor key and search", { OPENAI_API_KEY: "k" }, true, "keyless"],
        ["a Gemini key and search", gemini, true, "live"],
        ["a CHAT_BASE_URL endpoint and search", endpoint, true, "live"],
        [
            "a CHAT_BASE_URL endpoint and Foursquare",
            { ...endpoint, FOURSQUARE_SERVICE_KEY: "f" },
            false,
            "live",
        ],
    ];
    it.each(autoCases)("auto with %s", (_label, env, search, mode) => {
        expect(pickRunMode("auto", readRunEnvironment(env, false, search))).toBe(mode);
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
