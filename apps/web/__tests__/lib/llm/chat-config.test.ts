import {
    ChatConfigurationError,
    buildChatModelsConfig,
    createChatModelsConfig,
    getChatModelPreset,
    listChatModelPresets,
    parseChatModelsYaml,
    type ChatEndpointConfig,
} from "@launchstack/llm";

const endpoint: ChatEndpointConfig = {
    baseUrl: "https://endpoint.example/v1",
    apiKey: "endpoint-key",
};

function build(yaml: string) {
    return createChatModelsConfig({ yaml, endpoint, sourceLabel: "test.yaml" });
}

const TEXT_BEHAVIOR = `
      input: [text]
      reasoning: { mode: none }
      nativeStructuredOutput: []
      parameters:
        temperature: supported
        systemMessages: supported
        streaming: supported
        maxOutputTokens: supported`;

describe("chat model configuration file", () => {
    it("parses a minimal file and joins it to the endpoint", () => {
        const config = build(`
version: 1
models:
  primary:
    id: vendor/any-model-v17
    behavior:${TEXT_BEHAVIOR}
routes:
  default: primary
`);

        expect(config.version).toBe(1);
        expect(config.endpoint).toEqual(endpoint);
        expect(config.models.get("primary")?.id).toBe("vendor/any-model-v17");
        expect(config.routes.default).toBe("primary");
        expect(config.routes.vision).toBeUndefined();
    });

    it("accepts arbitrary model ids without an allowlist", () => {
        for (const id of ["gpt-4o", "MiniMax-M2", "org/model:tag-2027", "llama3.1:8b", "a"]) {
            const config = build(`
version: 1
models:
  primary:
    id: "${id}"
    behavior:${TEXT_BEHAVIOR}
routes:
  default: primary
`);
            expect(config.models.get("primary")?.id).toBe(id);
        }
    });

    it("rejects an unsupported schema version", () => {
        expect(() =>
            build(`
version: 99
models:
  primary:
    id: m
    behavior:${TEXT_BEHAVIOR}
routes:
  default: primary
`)
        ).toThrow(/unsupported schema version 99/i);
    });

    it("rejects malformed YAML with an actionable message", () => {
        expect(() => build("version: 1\n  models: [oops")).toThrow(ChatConfigurationError);
    });

    it("requires the default route", () => {
        expect(() =>
            build(`
version: 1
models:
  primary:
    id: m
    behavior:${TEXT_BEHAVIOR}
routes:
  fast: primary
`)
        ).toThrow(/routes\.default/);
    });

    it("rejects a route pointing at an undeclared model", () => {
        expect(() =>
            build(`
version: 1
models:
  primary:
    id: m
    behavior:${TEXT_BEHAVIOR}
routes:
  default: primary
  fast: nonexistent
`)
        ).toThrow(/references model "nonexistent"/);
    });

    it("requires CHAT_BASE_URL", () => {
        expect(() =>
            buildChatModelsConfig({
                file: parseChatModelsYaml(`
version: 1
models:
  primary:
    id: m
    behavior:${TEXT_BEHAVIOR}
routes:
  default: primary
`),
                endpoint: { baseUrl: "  " },
            })
        ).toThrow(/CHAT_BASE_URL is required/);
    });

    it("omits an empty API key so keyless endpoints stay keyless", () => {
        const config = createChatModelsConfig({
            yaml: `
version: 1
models:
  primary:
    id: m
    behavior:${TEXT_BEHAVIOR}
routes:
  default: primary
`,
            endpoint: { baseUrl: "http://localhost:11434/v1", apiKey: "   " },
        });
        expect(config.endpoint.apiKey).toBeUndefined();
    });
});

describe("model behavior declarations", () => {
    it("refuses a model with neither a preset nor a behavior", () => {
        expect(() =>
            build(`
version: 1
models:
  primary:
    id: some-unknown-model
routes:
  default: primary
`)
        ).toThrow(/must either reference a preset or declare a complete behavior/);
    });

    it("never infers behavior from a model id resembling a known model", () => {
        const config = build(`
version: 1
models:
  primary:
    id: openai/gpt-4o-but-actually-a-clone
    behavior:${TEXT_BEHAVIOR}
routes:
  default: primary
`);
        const behavior = config.models.get("primary")!.behavior;
        expect(behavior.input).toEqual(["text"]);
        expect(behavior.reasoning.mode).toBe("none");
        expect(behavior.nativeStructuredOutput).toEqual([]);
    });

    it("rejects an incomplete behavior declaration", () => {
        expect(() =>
            build(`
version: 1
models:
  primary:
    id: m
    behavior:
      input: [text]
      reasoning: { mode: none }
routes:
  default: primary
`)
        ).toThrow(/nativeStructuredOutput|parameters/);
    });

    it("leaves undeclared limits unknown rather than inventing defaults", () => {
        const config = build(`
version: 1
models:
  primary:
    id: m
    behavior:${TEXT_BEHAVIOR}
routes:
  default: primary
`);
        expect(config.models.get("primary")!.behavior.limits).toBeUndefined();
    });
});

describe("presets", () => {
    it("records a source and verification date for every entry", () => {
        const presets = listChatModelPresets();
        expect(presets.length).toBeGreaterThan(0);
        for (const preset of presets) {
            expect(preset.source).toMatch(/^https:\/\//);
            expect(preset.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
    });

    it("applies preset behavior to a model referencing it", () => {
        const config = build(`
version: 1
models:
  primary:
    id: gpt-4o
    preset: openai/gpt-4o
routes:
  default: primary
`);
        const model = config.models.get("primary")!;
        expect(model.preset).toBe("openai/gpt-4o");
        expect(model.behavior).toEqual(getChatModelPreset("openai/gpt-4o")!.behavior);
    });

    it("reports an unknown preset with the available names", () => {
        expect(() =>
            build(`
version: 1
models:
  primary:
    id: m
    preset: nope/not-real
routes:
  default: primary
`)
        ).toThrow(/unknown preset "nope\/not-real".*Available presets/s);
    });

    it("lets an override disable a capability the preset claims", () => {
        const config = build(`
version: 1
models:
  primary:
    id: gpt-4o
    preset: openai/gpt-4o
    behavior:
      input: [text]
      nativeStructuredOutput: []
routes:
  default: primary
`);
        const behavior = config.models.get("primary")!.behavior;
        expect(getChatModelPreset("openai/gpt-4o")!.behavior.input).toContain("image");
        expect(behavior.input).toEqual(["text"]);
        expect(behavior.nativeStructuredOutput).toEqual([]);
        // Untouched keys still come from the preset.
        expect(behavior.parameters.temperature).toBe("supported");
    });

    it("lets an override enable a capability the preset omits", () => {
        const config = build(`
version: 1
models:
  primary:
    id: local-vision
    preset: generic/openai-compatible-text
    behavior:
      input: [text, image]
      image:
        mimeTypes: [image/png]
        maxImages: 2
routes:
  default: primary
`);
        const behavior = config.models.get("primary")!.behavior;
        expect(behavior.input).toEqual(["text", "image"]);
        expect(behavior.image).toEqual({ mimeTypes: ["image/png"], maxImages: 2 });
    });

    it("merges parameters field by field", () => {
        const config = build(`
version: 1
models:
  primary:
    id: gpt-4o
    preset: openai/gpt-4o
    behavior:
      parameters:
        temperature: unsupported
routes:
  default: primary
`);
        const parameters = config.models.get("primary")!.behavior.parameters;
        expect(parameters.temperature).toBe("unsupported");
        expect(parameters.systemMessages).toBe("supported");
        expect(parameters.streaming).toBe("supported");
    });
});

describe("reasoning declarations", () => {
    function withReasoning(reasoning: string) {
        return build(`
version: 1
models:
  primary:
    id: m
    behavior:
      input: [text]
      reasoning:
${reasoning}
      nativeStructuredOutput: []
      parameters:
        temperature: supported
        systemMessages: supported
        streaming: supported
        maxOutputTokens: supported
routes:
  default: primary
`);
    }

    it("accepts every declared mode", () => {
        expect(
            withReasoning("        mode: none").models.get("primary")!.behavior.reasoning.mode
        ).toBe("none");
        expect(
            withReasoning("        mode: always").models.get("primary")!.behavior.reasoning.mode
        ).toBe("always");
        expect(
            withReasoning("        mode: toggle\n        on: { think: true }").models.get(
                "primary"
            )!.behavior.reasoning.mode
        ).toBe("toggle");
        expect(
            withReasoning(
                "        mode: effort\n        levels:\n          low: { reasoning_effort: low }\n        default: low"
            ).models.get("primary")!.behavior.reasoning.mode
        ).toBe("effort");
        expect(
            withReasoning(
                "        mode: budget\n        field: thinking_budget\n        default: 100\n        min: 10\n        max: 1000"
            ).models.get("primary")!.behavior.reasoning.mode
        ).toBe("budget");
    });

    it("rejects an unknown mode", () => {
        expect(() => withReasoning("        mode: telepathy")).toThrow(ChatConfigurationError);
    });

    it("rejects an effort default that is not a declared level", () => {
        expect(() =>
            withReasoning(
                "        mode: effort\n        levels:\n          low: { reasoning_effort: low }\n        default: extreme"
            )
        ).toThrow(/Default effort "extreme" is not one of the declared levels/);
    });

    it("rejects an effort mode with no levels", () => {
        expect(() =>
            withReasoning("        mode: effort\n        levels: {}\n        default: low")
        ).toThrow(/needs at least one level/);
    });

    it("rejects a budget default outside its own bounds", () => {
        expect(() =>
            withReasoning(
                "        mode: budget\n        field: b\n        default: 5000\n        min: 10\n        max: 1000"
            )
        ).toThrow(/default must fall between min and max/);
    });

    it("rejects a budget whose min exceeds its max", () => {
        expect(() =>
            withReasoning(
                "        mode: budget\n        field: b\n        default: 50\n        min: 1000\n        max: 10"
            )
        ).toThrow(/min must not exceed max/);
    });

    it.each([
        ["model", "        mode: toggle\n        on: { model: sneaky-swap }"],
        ["messages", "        mode: toggle\n        on: { messages: [] }"],
        ["stream", "        mode: toggle\n        on: { stream: true }"],
        ["api_key", "        mode: toggle\n        on: { api_key: leaked }"],
        ["base_url", "        mode: always\n        request: { base_url: http://evil }"],
    ])("refuses a reasoning patch writing the reserved field %s", (_field, reasoning) => {
        expect(() => withReasoning(reasoning)).toThrow(/reserved request field/);
    });

    it("refuses a reasoning budget targeting a reserved field", () => {
        expect(() =>
            withReasoning(
                "        mode: budget\n        field: model\n        default: 50\n        min: 10\n        max: 100"
            )
        ).toThrow(/reserved request field "model"/);
    });

    it("refuses an output-token cap targeting a reserved field", () => {
        expect(() =>
            build(`
version: 1
models:
  primary:
    id: m
    behavior:
      input: [text]
      reasoning: { mode: none }
      nativeStructuredOutput: []
      parameters:
        temperature: supported
        systemMessages: supported
        streaming: supported
        maxOutputTokens: supported
        maxOutputTokensField: messages
routes:
  default: primary
`)
        ).toThrow(/reserved request field "messages"/);
    });
});

describe("startup validation of explicit routes", () => {
    const yaml = (route: string) => `
version: 1
models:
  texty:
    id: text-only
    behavior:${TEXT_BEHAVIOR}
routes:
  default: texty
  ${route}: texty
`;

    it("fails startup when an explicit vision route lacks image input", () => {
        expect(() => build(yaml("vision"))).toThrow(
            /the "vision" route is assigned to model "texty".*does not declare image input/s
        );
    });

    it("fails startup when an explicit reasoning route lacks a reasoning mode", () => {
        expect(() => build(yaml("reasoning"))).toThrow(
            /the "reasoning" route is assigned to model "texty".*does not declare a reasoning mode/s
        );
    });

    it("allows an explicit fast route on any model", () => {
        expect(() => build(yaml("fast"))).not.toThrow();
    });
});
