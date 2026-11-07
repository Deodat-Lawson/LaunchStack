import type * as EnvModule from "~/env";

const mockServerEnv: Record<string, string | undefined> = {};
const mockGetEngine = jest.fn();
const mockGetTranscriptionProvider = jest.fn();
const mockTranscribe = jest.fn();
const mockFetch = jest.fn();

jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("dotenv", () => ({ config: jest.fn() }));
jest.mock("~/env", () => ({
    get env() {
        return { server: mockServerEnv };
    },
}));
jest.mock("~/server/engine", () => ({ getEngine: () => mockGetEngine() }));
jest.mock("@launchstack/conversion/audio-transcription", () => ({
    getTranscriptionProvider: () => mockGetTranscriptionProvider(),
}));

import { transcribeCallNotesAudio } from "~/server/call-notes/transcription";

const AUDIO_WAV = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x7f, 0x80, 0xff]);
const AZURE_BASE_URL = "https://speech.example.test/custom/?region=northeurope";
const AZURE_API_KEY = "private-azure-transcription-key";

async function azureRequest() {
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [input, init] = mockFetch.mock.calls[0]! as Parameters<typeof fetch>;
    const request = new Request(input, init);
    expect(request.method).toBe("POST");
    expect(request.headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=/);
    const form = await request.formData();
    const definitionPart = form.get("definition");
    if (definitionPart === null) throw new Error("Azure request is missing its definition");
    const definition = JSON.parse(
        typeof definitionPart === "string" ? definitionPart : await definitionPart.text()
    ) as { locales?: string[] };
    return { request, form, definition };
}

beforeEach(() => {
    jest.resetAllMocks();
    for (const key of Object.keys(mockServerEnv)) delete mockServerEnv[key];
    mockGetTranscriptionProvider.mockResolvedValue({ transcribe: mockTranscribe });
    mockTranscribe.mockResolvedValue({
        data: { text: "We will follow up tomorrow.", language: "en" },
    });
    mockFetch.mockResolvedValue(Response.json({ combinedPhrases: [] }));
    jest.spyOn(globalThis, "fetch").mockImplementation(mockFetch);
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe("call-notes transcription through the shared registry", () => {
    it("bootstraps the engine before resolving the provider and forwards only the WAV bytes", async () => {
        const paddedAudio = Uint8Array.from([0xaa, ...AUDIO_WAV, 0xbb]);
        const audioWav = paddedAudio.subarray(1, -1);

        const result = await transcribeCallNotesAudio({ audioWav, language: "vi-VN" });

        expect(result).toEqual({ text: "We will follow up tomorrow.", language: "en" });
        expect(mockGetEngine).toHaveBeenCalledTimes(1);
        expect(mockGetTranscriptionProvider).toHaveBeenCalledTimes(1);
        expect(mockGetEngine.mock.invocationCallOrder[0]).toBeLessThan(
            mockGetTranscriptionProvider.mock.invocationCallOrder[0]!
        );
        expect(mockTranscribe).toHaveBeenCalledTimes(1);
        expect(mockTranscribe).toHaveBeenCalledWith(expect.any(Buffer), "capture.wav", {
            mimeType: "audio/wav",
            timestamps: false,
        });
        expect(mockTranscribe.mock.calls[0]![0]).toEqual(Buffer.from(audioWav));
        expect(mockFetch).not.toHaveBeenCalled();
    });
});

describe("call-notes transcription through Azure Speech", () => {
    beforeEach(() => {
        mockServerEnv.CALL_NOTES_TRANSCRIPTION_PROVIDER = "azure_speech";
        mockServerEnv.CALL_NOTES_TRANSCRIPTION_BASE_URL = AZURE_BASE_URL;
        mockServerEnv.CALL_NOTES_TRANSCRIPTION_API_KEY = AZURE_API_KEY;
    });

    it("appends the Fast Transcription endpoint and sends a keyed multipart WAV with input locales", async () => {
        await transcribeCallNotesAudio({ audioWav: AUDIO_WAV, language: "vi-VN" });

        const { request, form, definition } = await azureRequest();
        const url = new URL(request.url);
        expect(url.origin).toBe("https://speech.example.test");
        expect(url.pathname).toBe("/custom/speechtotext/transcriptions:transcribe");
        expect(url.searchParams.get("api-version")).toBe("2025-10-15");
        expect(url.searchParams.get("region")).toBe("northeurope");
        expect(request.headers.get("Ocp-Apim-Subscription-Key")).toBe(AZURE_API_KEY);
        const audio = form.get("audio");
        if (audio === null || typeof audio === "string") {
            throw new Error("Azure request is missing its audio file");
        }
        expect(audio.name).toBe("capture.wav");
        expect(audio.type).toBe("audio/wav");
        expect(new Uint8Array(await audio.arrayBuffer())).toEqual(AUDIO_WAV);
        expect(definition.locales).toEqual(["vi-VN"]);
        expect(mockGetEngine).not.toHaveBeenCalled();
        expect(mockGetTranscriptionProvider).not.toHaveBeenCalled();
        expect(mockTranscribe).not.toHaveBeenCalled();
    });

    it("uses the configured default language when the input has no language", async () => {
        mockServerEnv.CALL_NOTES_TRANSCRIPTION_LANGUAGE = "en-US";

        await transcribeCallNotesAudio({ audioWav: AUDIO_WAV });

        expect((await azureRequest()).definition.locales).toEqual(["en-US"]);
    });

    it("lets the input language override the configured default", async () => {
        mockServerEnv.CALL_NOTES_TRANSCRIPTION_LANGUAGE = "en-US";

        await transcribeCallNotesAudio({ audioWav: AUDIO_WAV, language: "vi-VN" });

        expect((await azureRequest()).definition.locales).toEqual(["vi-VN"]);
    });

    it("omits locales when neither the input nor the environment specifies a language", async () => {
        await transcribeCallNotesAudio({ audioWav: AUDIO_WAV });

        expect((await azureRequest()).definition).not.toHaveProperty("locales");
    });

    it("preserves an already-complete endpoint and its existing API version and query parameters", async () => {
        mockServerEnv.CALL_NOTES_TRANSCRIPTION_BASE_URL =
            "https://speech.example.test/speechtotext/transcriptions:transcribe?api-version=2024-11-15&region=westus";

        await transcribeCallNotesAudio({ audioWav: AUDIO_WAV });

        const { request } = await azureRequest();
        const url = new URL(request.url);
        expect(url.pathname).toBe("/speechtotext/transcriptions:transcribe");
        expect(url.searchParams.getAll("api-version")).toEqual(["2024-11-15"]);
        expect(url.searchParams.get("region")).toBe("westus");
    });

    it("joins combined phrase text with spaces in the upstream order", async () => {
        mockFetch.mockResolvedValue(
            Response.json({
                combinedPhrases: [
                    { channel: 0, text: "We will follow up tomorrow." },
                    { channel: 1, text: "I will send the checklist." },
                ],
            })
        );

        const result = await transcribeCallNotesAudio({ audioWav: AUDIO_WAV });

        expect(result.text).toBe("We will follow up tomorrow. I will send the checklist.");
    });

    it("returns an empty transcript when Azure has no combined phrases", async () => {
        mockFetch.mockResolvedValue(Response.json({ combinedPhrases: [] }));

        expect((await transcribeCallNotesAudio({ audioWav: AUDIO_WAV })).text).toBe("");
    });

    it.each([401, 503])(
        "rejects HTTP %s without disclosing the provider body, API key, or audio",
        async status => {
            const audioText = "private-call-audio-payload";
            const audioWav = Uint8Array.from(Buffer.from(audioText));
            const audioBase64 = Buffer.from(audioWav).toString("base64");
            const bodyMarker = "private-provider-error-body";
            const responseBody = `${bodyMarker}: ${AZURE_API_KEY}; ${audioText}; ${audioBase64}`;
            const logSpies = (["debug", "error", "info", "log", "warn"] as const).map(method =>
                jest.spyOn(console, method).mockImplementation(() => undefined)
            );
            mockFetch.mockResolvedValue(new Response(responseBody, { status }));

            const pending = transcribeCallNotesAudio({ audioWav });
            await expect(pending).rejects.toThrow();
            const error = (await pending.catch((reason: unknown) => reason)) as Error;
            const exposed = [
                error.message,
                error.stack,
                JSON.stringify(error),
                JSON.stringify(logSpies.map(spy => spy.mock.calls)),
            ].join("\n");

            for (const secret of [bodyMarker, AZURE_API_KEY, audioText, audioBase64]) {
                expect(exposed).not.toContain(secret);
            }
        }
    );

    it("aborts the outgoing Azure signal when the caller cancels", async () => {
        const controller = new AbortController();
        let fetchSignal: AbortSignal | null | undefined;
        let initiallyAborted: boolean | undefined;
        mockFetch.mockImplementation(async (_input: unknown, init?: RequestInit) => {
            fetchSignal = init?.signal;
            initiallyAborted = fetchSignal?.aborted;
            controller.abort();
            throw new DOMException("The operation was aborted.", "AbortError");
        });

        await expect(
            transcribeCallNotesAudio({ audioWav: AUDIO_WAV, signal: controller.signal })
        ).rejects.toThrow();

        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(initiallyAborted).toBe(false);
        expect(fetchSignal?.aborted).toBe(true);
    });
});

describe("call-notes transcription environment validation", () => {
    function readServerEnv(values: Record<string, string | undefined> = {}) {
        const previousEnv = process.env;
        process.env = {
            NODE_ENV: "test",
            SKIP_ENV_VALIDATION: "false",
            DATABASE_URL: "postgres://localhost/capture-transcription-test",
            BETTER_AUTH_SECRET: "capture-test-auth-secret-with-at-least-32-characters",
            CHAT_BASE_URL: "https://chat.example.test/v1",
            INNGEST_DEV: "1",
            ...values,
        };
        try {
            let loaded: typeof EnvModule | undefined;
            jest.isolateModules(() => {
                loaded = jest.requireActual<typeof EnvModule>("~/env");
            });
            return loaded!.env.server;
        } finally {
            process.env = previousEnv;
        }
    }

    it("allows the shared registry without Azure provider settings", () => {
        const server = readServerEnv();

        expect(server.CALL_NOTES_TRANSCRIPTION_PROVIDER).toBeUndefined();
        expect(server.CALL_NOTES_TRANSCRIPTION_BASE_URL).toBeUndefined();
        expect(server.CALL_NOTES_TRANSCRIPTION_API_KEY).toBeUndefined();
        expect(server.CALL_NOTES_TRANSCRIPTION_LANGUAGE).toBeUndefined();
    });

    it.each([
        {
            setting: "both the URL and API key",
            values: {},
            missing: ["CALL_NOTES_TRANSCRIPTION_BASE_URL", "CALL_NOTES_TRANSCRIPTION_API_KEY"],
        },
        {
            setting: "the URL",
            values: { CALL_NOTES_TRANSCRIPTION_API_KEY: AZURE_API_KEY },
            missing: ["CALL_NOTES_TRANSCRIPTION_BASE_URL"],
        },
        {
            setting: "the API key",
            values: { CALL_NOTES_TRANSCRIPTION_BASE_URL: AZURE_BASE_URL },
            missing: ["CALL_NOTES_TRANSCRIPTION_API_KEY"],
        },
    ])("requires $setting when Azure Speech is selected", ({ values, missing }) => {
        let failure: unknown;
        try {
            readServerEnv({
                CALL_NOTES_TRANSCRIPTION_PROVIDER: "azure_speech",
                ...values,
            });
        } catch (error) {
            failure = error;
        }

        expect(failure).toBeInstanceOf(Error);
        expect(failure).toMatchObject({
            issues: expect.arrayContaining(
                missing.map(key => ({
                    code: "custom",
                    path: [key],
                    message: `${key} is required when CALL_NOTES_TRANSCRIPTION_PROVIDER is "azure_speech"`,
                }))
            ),
        });
    });

    it("maps all four Azure transcription process variables into validated server settings", () => {
        const values = {
            CALL_NOTES_TRANSCRIPTION_PROVIDER: "azure_speech",
            CALL_NOTES_TRANSCRIPTION_BASE_URL: AZURE_BASE_URL,
            CALL_NOTES_TRANSCRIPTION_API_KEY: AZURE_API_KEY,
            CALL_NOTES_TRANSCRIPTION_LANGUAGE: "vi-VN",
        };

        expect(readServerEnv(values)).toMatchObject(values);
    });
});
