import {
    ChatRouteUnavailableError,
    InvalidReasoningControlError,
    createChatModelsConfig,
    getPublicChatConfig,
    isChatRequestError,
    resolveChatModel,
    resolveChatRoute,
    selectChatRoute,
    type ChatModelsConfig,
} from "@launchstack/core/llm";

const endpoint = { baseUrl: "https://endpoint.example/v1", apiKey: "k" };

function config(yaml: string): ChatModelsConfig {
    return createChatModelsConfig({ yaml, endpoint, sourceLabel: "test.yaml" });
}

const TEXT = `
      input: [text]
      reasoning: { mode: none }
      nativeStructuredOutput: []
      parameters:
        temperature: supported
        systemMessages: supported
        streaming: supported
        maxOutputTokens: supported`;

const VISION_AND_REASONING = `
      input: [text, image]
      reasoning:
        mode: toggle
        on: { think: true }
      nativeStructuredOutput: [json-schema]
      parameters:
        temperature: supported
        systemMessages: supported
        streaming: supported
        maxOutputTokens: supported`;

const VISION_ONLY = `
      input: [text, image]
      reasoning: { mode: none }
      nativeStructuredOutput: []
      parameters:
        temperature: supported
        systemMessages: supported
        streaming: supported
        maxOutputTokens: supported`;

const TEXT_ONLY_DEPLOYMENT = config(`
version: 1
models:
  primary:
    id: text-model
    behavior:${TEXT}
routes:
  default: primary
`);

const CAPABLE_DEPLOYMENT = config(`
version: 1
models:
  omni:
    id: omni-model
    behavior:${VISION_AND_REASONING}
routes:
  default: omni
`);

describe("route inheritance", () => {
    it("serves the default route from its assigned model", () => {
        const resolved = resolveChatRoute("default", TEXT_ONLY_DEPLOYMENT);
        expect(resolved.definition.id).toBe("text-model");
        expect(resolved.inheritsDefault).toBe(false);
    });

    it("inherits default for fast regardless of capability", () => {
        const resolved = resolveChatRoute("fast", TEXT_ONLY_DEPLOYMENT);
        expect(resolved.definition.id).toBe("text-model");
        expect(resolved.inheritsDefault).toBe(true);
    });

    it("uses an explicitly assigned fast model instead of inheriting", () => {
        const deployment = config(`
version: 1
models:
  big:
    id: big-model
    behavior:${TEXT}
  small:
    id: small-model
    behavior:${TEXT}
routes:
  default: big
  fast: small
`);
        const resolved = resolveChatRoute("fast", deployment);
        expect(resolved.definition.id).toBe("small-model");
        expect(resolved.inheritsDefault).toBe(false);
    });

    it("inherits default for reasoning and vision when the default model is capable", () => {
        for (const route of ["reasoning", "vision"] as const) {
            const resolved = resolveChatRoute(route, CAPABLE_DEPLOYMENT);
            expect(resolved.definition.id).toBe("omni-model");
            expect(resolved.inheritsDefault).toBe(true);
        }
    });

    it.each([
        ["reasoning", /does not declare a reasoning mode/],
        ["vision", /does not declare image input/],
    ] as const)(
        "reports %s unavailable rather than inheriting an incapable default",
        (route, pattern) => {
            let thrown: unknown;
            try {
                resolveChatRoute(route, TEXT_ONLY_DEPLOYMENT);
            } catch (error) {
                thrown = error;
            }
            expect(thrown).toBeInstanceOf(ChatRouteUnavailableError);
            const error = thrown as ChatRouteUnavailableError;
            expect(error.status).toBe(400);
            expect(error.route).toBe(route);
            expect(error.reason).toBe("route-not-configured");
            expect(error.message).toMatch(pattern);
        }
    );

    it("never substitutes a different model for an unavailable route", () => {
        const deployment = config(`
version: 1
models:
  texty:
    id: text-model
    behavior:${TEXT}
  looker:
    id: vision-model
    behavior:${VISION_ONLY}
routes:
  default: texty
  vision: looker
`);
        // The vision-capable model exists, but it must not be borrowed for a
        // reasoning request just because it is the only "richer" model around.
        expect(() => resolveChatRoute("reasoning", deployment)).toThrow(ChatRouteUnavailableError);
    });
});

describe("required capabilities", () => {
    it("rejects a request whose route model lacks a required capability", () => {
        const deployment = config(`
version: 1
models:
  texty:
    id: text-model
    behavior:${TEXT}
  looker:
    id: vision-model
    behavior:${VISION_ONLY}
routes:
  default: texty
  vision: looker
`);
        let thrown: unknown;
        try {
            resolveChatModel({
                route: "vision",
                requiredCapabilities: ["vision", "reasoning"],
                config: deployment,
            });
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(ChatRouteUnavailableError);
        const error = thrown as ChatRouteUnavailableError;
        expect(error.status).toBe(400);
        expect(error.reason).toBe("missing-capability");
        expect(error.missingCapabilities).toEqual(["reasoning"]);
    });

    it("succeeds when the route model has every required capability", () => {
        const resolved = resolveChatModel({
            route: "vision",
            requiredCapabilities: ["vision", "reasoning"],
            reasoningControl: { enabled: true },
            config: CAPABLE_DEPLOYMENT,
        });
        expect(resolved.modelId).toBe("omni-model");
        expect(resolved.reasoning.enabled).toBe(true);
    });
});

describe("selectChatRoute", () => {
    it("picks the vision route and requires reasoning too when both are needed", () => {
        expect(selectChatRoute({ vision: true, reasoning: true })).toEqual({
            route: "vision",
            requiredCapabilities: ["vision", "reasoning"],
        });
    });

    it.each([
        [{ vision: true }, "vision", ["vision"]],
        [{ reasoning: true }, "reasoning", ["reasoning"]],
        [{ fast: true }, "fast", []],
        [{}, "default", []],
    ] as const)("maps %p to the %s route", (need, route, capabilities) => {
        expect(selectChatRoute(need)).toEqual({
            route,
            requiredCapabilities: capabilities,
        });
    });

    it("produces a typed 400 for vision plus reasoning on a vision-only model", () => {
        const deployment = config(`
version: 1
models:
  looker:
    id: vision-model
    behavior:${VISION_ONLY}
routes:
  default: looker
`);
        const { route, requiredCapabilities } = selectChatRoute({
            vision: true,
            reasoning: true,
        });

        let thrown: unknown;
        try {
            resolveChatModel({ route, requiredCapabilities, config: deployment });
        } catch (error) {
            thrown = error;
        }
        expect(isChatRequestError(thrown)).toBe(true);
        expect((thrown as ChatRouteUnavailableError).status).toBe(400);
        expect((thrown as ChatRouteUnavailableError).missingCapabilities).toEqual(["reasoning"]);
    });
});

describe("reasoning control validation", () => {
    it("rejects enabling reasoning on a model declaring mode none", () => {
        let thrown: unknown;
        try {
            resolveChatModel({
                reasoningControl: { enabled: true },
                config: TEXT_ONLY_DEPLOYMENT,
            });
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(ChatRouteUnavailableError);
        expect((thrown as ChatRouteUnavailableError).missingCapabilities).toEqual(["reasoning"]);
    });

    it("rejects an effort level the model does not offer", () => {
        const deployment = config(`
version: 1
models:
  thinker:
    id: thinker
    behavior:
      input: [text]
      reasoning:
        mode: effort
        levels:
          low: { reasoning_effort: low }
          high: { reasoning_effort: high }
        default: low
      nativeStructuredOutput: []
      parameters:
        temperature: supported
        systemMessages: supported
        streaming: supported
        maxOutputTokens: supported
routes:
  default: thinker
`);
        let thrown: unknown;
        try {
            resolveChatModel({
                reasoningControl: { enabled: true, effort: "ludicrous" },
                config: deployment,
            });
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(InvalidReasoningControlError);
        expect((thrown as InvalidReasoningControlError).status).toBe(400);
        expect((thrown as Error).message).toMatch(/Available levels: low, high/);
    });

    it("rejects a budget outside the declared bounds", () => {
        const deployment = config(`
version: 1
models:
  thinker:
    id: thinker
    behavior:
      input: [text]
      reasoning:
        mode: budget
        field: thinking_budget
        default: 8000
        min: 1024
        max: 32000
      nativeStructuredOutput: []
      parameters:
        temperature: supported
        systemMessages: supported
        streaming: supported
        maxOutputTokens: supported
routes:
  default: thinker
`);
        expect(() =>
            resolveChatModel({
                reasoningControl: { enabled: true, budgetTokens: 999_999 },
                config: deployment,
            })
        ).toThrow(InvalidReasoningControlError);
        expect(() =>
            resolveChatModel({
                reasoningControl: { enabled: true, budgetTokens: 8000 },
                config: deployment,
            })
        ).not.toThrow();
    });
});

describe("public configuration", () => {
    it("reports availability, effective model, and inheritance per route", () => {
        const publicConfig = getPublicChatConfig(CAPABLE_DEPLOYMENT);
        expect(publicConfig.routes.default).toMatchObject({
            available: true,
            model: "omni-model",
            inheritsDefault: false,
        });
        expect(publicConfig.routes.vision).toMatchObject({
            available: true,
            model: "omni-model",
            inheritsDefault: true,
            vision: { supported: true },
        });
        expect(publicConfig.routes.reasoning?.reasoning).toEqual({
            mode: "toggle",
            controllable: true,
        });
        expect(publicConfig.routes.default.nativeStructuredOutput).toEqual(["json-schema"]);
    });

    it("marks unavailable routes with a reason instead of throwing", () => {
        const publicConfig = getPublicChatConfig(TEXT_ONLY_DEPLOYMENT);
        expect(publicConfig.routes.default.available).toBe(true);
        expect(publicConfig.routes.fast.available).toBe(true);
        expect(publicConfig.routes.vision).toMatchObject({ available: false });
        expect(publicConfig.routes.vision.unavailableReason).toMatch(
            /does not declare image input/
        );
        expect(publicConfig.routes.reasoning.available).toBe(false);
    });

    it("exposes selectable effort levels but not the request patches", () => {
        const deployment = config(`
version: 1
models:
  thinker:
    id: thinker
    behavior:
      input: [text]
      reasoning:
        mode: effort
        levels:
          low: { reasoning_effort: low, secret_internal_flag: true }
          high: { reasoning_effort: high }
        default: low
      nativeStructuredOutput: []
      parameters:
        temperature: supported
        systemMessages: supported
        streaming: supported
        maxOutputTokens: supported
      limits:
        contextTokens: 128000
routes:
  default: thinker
`);
        const publicConfig = getPublicChatConfig(deployment);
        expect(publicConfig.routes.reasoning.reasoning).toEqual({
            mode: "effort",
            controllable: true,
            efforts: ["low", "high"],
            defaultEffort: "low",
        });

        const serialized = JSON.stringify(publicConfig);
        expect(serialized).not.toContain("secret_internal_flag");
        expect(serialized).not.toContain("reasoning_effort");
        expect(serialized).not.toContain("endpoint.example");
        expect(serialized).not.toContain("128000");
        expect(serialized).not.toMatch(/apiKey|api_key/i);
    });

    it("exposes a budget range without the request field name", () => {
        const deployment = config(`
version: 1
models:
  thinker:
    id: thinker
    behavior:
      input: [text]
      reasoning:
        mode: budget
        field: internal_budget_field
        default: 8000
        min: 1024
        max: 32000
      nativeStructuredOutput: []
      parameters:
        temperature: supported
        systemMessages: supported
        streaming: supported
        maxOutputTokens: supported
routes:
  default: thinker
`);
        const publicConfig = getPublicChatConfig(deployment);
        expect(publicConfig.routes.reasoning.reasoning?.budget).toEqual({
            min: 1024,
            max: 32000,
            default: 8000,
        });
        expect(JSON.stringify(publicConfig)).not.toContain("internal_budget_field");
    });

    it("marks an always-reasoning model as not controllable", () => {
        const deployment = config(`
version: 1
models:
  thinker:
    id: thinker
    behavior:
      input: [text]
      reasoning:
        mode: always
        request: { thinking: true }
      nativeStructuredOutput: []
      parameters:
        temperature: supported
        systemMessages: supported
        streaming: supported
        maxOutputTokens: supported
routes:
  default: thinker
`);
        expect(getPublicChatConfig(deployment).routes.reasoning.reasoning).toEqual({
            mode: "always",
            controllable: false,
        });
    });
});
