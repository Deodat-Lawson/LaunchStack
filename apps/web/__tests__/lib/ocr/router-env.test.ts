/**
 * Tests for the credentials the app forwards to the ocr-router sidecar.
 *
 * The router runs the vision classifier, and its endpoint defaults to Gemini —
 * so it needs GOOGLE_AI_API_KEY to do anything but fall back to local SigLIP.
 * A router deployed alongside the app in Docker reads that key from its own
 * container env; one deployed separately (the Vercel topology in
 * docs/deployment/vercel.md) has no env of its own, and only sees what arrives
 * in the /route request body.
 *
 * Two failure modes are covered: the app withholding a key it holds, and the
 * app blanking a key it doesn't hold — the router writes this map into its own
 * process.env, so an empty string is destructive.
 */

import { determineDocumentRouting } from "@launchstack/core/ocr/complexity";
import { configureOcr } from "@launchstack/core/ocr/config";

const ROUTER_URL = "http://test-router:8002";
const DOCUMENT_URL = "https://example.com/doc.pdf";

describe("OCR router env forwarding", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        provider: "DOCLING",
        reason: "test",
        confidence: 1,
        pageCount: 1,
      }),
      text: async () => "",
    } as Response);
  });

  afterEach(() => {
    configureOcr({});
    global.fetch = originalFetch;
  });

  /** Runs one routing call and returns the env map that reached the router. */
  async function captureForwardedEnv(): Promise<Record<string, string>> {
    await determineDocumentRouting(DOCUMENT_URL);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`${ROUTER_URL}/route`);
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string) as {
      documentUrl: string;
      env: Record<string, string>;
    };
    expect(body.documentUrl).toBe(DOCUMENT_URL);
    return body.env;
  }

  it("forwards GOOGLE_AI_API_KEY when the app is the only holder of it", async () => {
    // The Vercel shape: app has the Google key, the remote router has nothing.
    configureOcr({
      routerUrl: ROUTER_URL,
      vision: { googleApiKey: "AIza-test-key" },
    });

    const env = await captureForwardedEnv();

    expect(env.GOOGLE_AI_API_KEY).toBe("AIza-test-key");
  });

  it("omits GOOGLE_AI_API_KEY entirely when the app has no Google key", async () => {
    // The Docker shape: the router holds the key itself. Sending "" here would
    // overwrite it in the router's process.env for every later request too.
    configureOcr({
      routerUrl: ROUTER_URL,
      vision: { openaiApiKey: "sk-test", aiBaseUrl: "https://api.example.com/v1" },
    });

    const env = await captureForwardedEnv();

    expect("GOOGLE_AI_API_KEY" in env).toBe(false);
  });

  it("never sends an empty value for any variable", async () => {
    configureOcr({ routerUrl: ROUTER_URL });

    const env = await captureForwardedEnv();

    expect(Object.values(env)).not.toContain("");
  });

  it("still forwards every credential it forwarded before", async () => {
    configureOcr({
      routerUrl: ROUTER_URL,
      defaultProvider: "DOCLING",
      workerUrl: "http://test-worker:8001",
      visionModel: "gemini-2.5-flash",
      datalabApiKey: "datalab-key",
      azure: { endpoint: "https://azure.example.com", key: "azure-key" },
      landingAi: { apiKey: "landing-key" },
      vision: {
        googleApiKey: "AIza-test-key",
        openaiApiKey: "sk-test",
        aiApiKey: "ai-key",
        aiBaseUrl: "https://api.example.com/v1",
      },
    });

    const env = await captureForwardedEnv();

    expect(env).toEqual({
      OCR_DEFAULT_PROVIDER: "DOCLING",
      OCR_WORKER_URL: "http://test-worker:8001",
      AZURE_DOC_INTELLIGENCE_KEY: "azure-key",
      AZURE_DOC_INTELLIGENCE_ENDPOINT: "https://azure.example.com",
      LANDING_AI_API_KEY: "landing-key",
      DATALAB_API_KEY: "datalab-key",
      GOOGLE_AI_API_KEY: "AIza-test-key",
      OPENAI_API_KEY: "sk-test",
      AI_API_KEY: "ai-key",
      AI_BASE_URL: "https://api.example.com/v1",
      OCR_VISION_MODEL: "gemini-2.5-flash",
    });
  });
});

/**
 * The router half of the same contract. applyRequestEnv snapshots the container
 * env at module load, so each test loads it fresh against a known baseline.
 */
describe("ocr-router applyRequestEnv", () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  /** Loads applyRequestEnv with `baseline` as the container's startup env. */
  async function loadWithBaseline(
    baseline: Record<string, string>
  ): Promise<(env: Record<string, string> | undefined) => void> {
    process.env = { ...baseline } as NodeJS.ProcessEnv;
    jest.resetModules();
    const mod = (await import(
      "../../../../../services/ocr-router/src/request-env"
    )) as { applyRequestEnv: (env: Record<string, string> | undefined) => void };
    return mod.applyRequestEnv;
  }

  it("keeps the container's own key when the request omits it", async () => {
    const applyRequestEnv = await loadWithBaseline({ GOOGLE_AI_API_KEY: "container-key" });

    applyRequestEnv({ OCR_WORKER_URL: "http://worker:8001" });

    expect(process.env.GOOGLE_AI_API_KEY).toBe("container-key");
  });

  it("keeps the container's own key when the request blanks it", async () => {
    const applyRequestEnv = await loadWithBaseline({ GOOGLE_AI_API_KEY: "container-key" });

    applyRequestEnv({ GOOGLE_AI_API_KEY: "" });

    expect(process.env.GOOGLE_AI_API_KEY).toBe("container-key");
  });

  it("lets the request's value win when it has one", async () => {
    const applyRequestEnv = await loadWithBaseline({ GOOGLE_AI_API_KEY: "container-key" });

    applyRequestEnv({ GOOGLE_AI_API_KEY: "request-key" });

    expect(process.env.GOOGLE_AI_API_KEY).toBe("request-key");
  });

  it("does not leak one request's values into the next", async () => {
    const applyRequestEnv = await loadWithBaseline({ GOOGLE_AI_API_KEY: "container-key" });

    applyRequestEnv({ AI_BASE_URL: "https://first.example.com/v1" });
    applyRequestEnv({ GOOGLE_AI_API_KEY: "request-key" });

    expect(process.env.AI_BASE_URL).toBeUndefined();
    expect(process.env.GOOGLE_AI_API_KEY).toBe("request-key");
  });

  it("restores a container value a previous request overrode", async () => {
    const applyRequestEnv = await loadWithBaseline({
      AI_BASE_URL: "https://container.example.com/v1",
    });

    applyRequestEnv({ AI_BASE_URL: "https://request.example.com/v1" });
    applyRequestEnv({});

    expect(process.env.AI_BASE_URL).toBe("https://container.example.com/v1");
  });
});
