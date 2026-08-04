/**
 * Endpoint and credential are resolved as a PAIR, everywhere.
 *
 * Making Gemini the default endpoint re-opened a hazard the previous release
 * had closed: if a URL resolver falls back to Gemini while a key resolver
 * independently picks up `AI_API_KEY` or `OPENAI_API_KEY`, the two meet in an
 * Authorization header addressed to Google. These tests pin the rule that
 * stops it — the Gemini fallback authenticates with a Google credential or
 * with nothing at all.
 */

import {
  configureProviders,
  resolveEndpoint,
} from "@launchstack/core/providers/registry";
import {
  configureAuxiliaryOpenAI,
  getOpenAIClient,
} from "@launchstack/core/llm";
import { GEMINI_BASE_URL } from "@launchstack/core/llm/types";

const OPENAI_KEY = "sk-proj-not-a-real-key";
const GOOGLE_KEY = "AIza-not-a-real-key";

describe("resolveEndpoint pairs the credential with the endpoint", () => {
  afterEach(() => {
    configureProviders({});
    jest.restoreAllMocks();
  });

  it("never sends a non-Google key to the Gemini fallback", () => {
    // The exact reported shape: a global key, no global URL.
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    configureProviders({ aiApiKey: OPENAI_KEY });

    const resolved = resolveEndpoint(undefined, undefined);

    expect(resolved.baseUrl).toBe(GEMINI_BASE_URL);
    expect(resolved.apiKey).toBe("");
    expect(resolved.apiKey).not.toBe(OPENAI_KEY);
  });

  it("never sends a non-Google capability key to the Gemini fallback", () => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    configureProviders({});

    const resolved = resolveEndpoint(undefined, OPENAI_KEY);

    expect(resolved.baseUrl).toBe(GEMINI_BASE_URL);
    expect(resolved.apiKey).toBe("");
  });

  it("says why a stranded credential is being ignored", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    configureProviders({ aiApiKey: OPENAI_KEY });

    resolveEndpoint(undefined, undefined);

    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/no endpoint names where it belongs/),
    );
  });

  it("uses the Google credential for the Gemini fallback", () => {
    configureProviders({ googleApiKey: GOOGLE_KEY });

    expect(resolveEndpoint(undefined, undefined)).toEqual({
      baseUrl: GEMINI_BASE_URL,
      apiKey: GOOGLE_KEY,
    });
  });

  it("prefers an explicitly named capability endpoint, with its own key", () => {
    configureProviders({ aiApiKey: "global", googleApiKey: GOOGLE_KEY });

    expect(resolveEndpoint("https://rerank.example/v1/", "cap-key")).toEqual({
      baseUrl: "https://rerank.example/v1",
      apiKey: "cap-key",
    });
  });

  it("falls back to the global endpoint and its key, not Gemini", () => {
    configureProviders({
      aiBaseUrl: "https://global.example/v1",
      aiApiKey: "global-key",
      googleApiKey: GOOGLE_KEY,
    });

    expect(resolveEndpoint(undefined, undefined)).toEqual({
      baseUrl: "https://global.example/v1",
      apiKey: "global-key",
    });
  });
});

describe("getOpenAIClient pairs the auxiliary credential with its endpoint", () => {
  afterEach(() => {
    configureAuxiliaryOpenAI({});
    jest.restoreAllMocks();
  });

  it("refuses to build a Gemini client from an OpenAI key", () => {
    // Before the fix this returned a client pointed at Google carrying an
    // `sk-proj-…`, because the URL defaulted while the key came from elsewhere.
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    configureAuxiliaryOpenAI({ apiKey: OPENAI_KEY });

    expect(getOpenAIClient()).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/will not be sent anywhere/),
    );
  });

  it("builds a Gemini client from a Google key when no endpoint is named", () => {
    configureAuxiliaryOpenAI({ googleApiKey: GOOGLE_KEY });

    const client = getOpenAIClient();

    expect(client).not.toBeNull();
    expect(client?.baseURL).toBe(GEMINI_BASE_URL);
    expect(client?.apiKey).toBe(GOOGLE_KEY);
  });

  it("uses the named endpoint with its own key when both are present", () => {
    configureAuxiliaryOpenAI({
      apiKey: OPENAI_KEY,
      baseUrl: "https://api.openai.com/v1",
      googleApiKey: GOOGLE_KEY,
    });

    const client = getOpenAIClient();

    expect(client?.baseURL).toBe("https://api.openai.com/v1");
    expect(client?.apiKey).toBe(OPENAI_KEY);
  });
});
