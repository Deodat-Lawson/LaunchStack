import { validateDeprecatedChatSelection } from "~/server/chat-request-compat";

const resolved = { modelId: "vendor/operator-model" };

describe("deprecated chat request selectors", () => {
  it("accepts an omitted selector", () => {
    expect(validateDeprecatedChatSelection({}, resolved)).toEqual({ ok: true });
  });

  it("accepts a client echoing back the model it was told about", () => {
    expect(
      validateDeprecatedChatSelection({ model: "vendor/operator-model" }, resolved),
    ).toEqual({ ok: true });
  });

  it("rejects a provider selector outright — providers no longer exist", () => {
    expect(
      validateDeprecatedChatSelection({ provider: "openrouter" }, resolved),
    ).toEqual({
      ok: false,
      status: 400,
      message:
        "Per-request provider selection is no longer supported; the deployment serves one chat endpoint configured by the operator",
    });
  });

  it("rejects a model override rather than silently ignoring it", () => {
    expect(
      validateDeprecatedChatSelection({ model: "request/override" }, resolved),
    ).toEqual({
      ok: false,
      status: 400,
      message:
        "Per-request model overrides are disabled; the model serving each route is operator-configured",
    });
  });

  it("reports the provider problem first when both selectors are present", () => {
    const result = validateDeprecatedChatSelection(
      { provider: "openai", model: "vendor/operator-model" },
      resolved,
    );
    expect(result).toMatchObject({ ok: false, status: 400 });
  });
});
