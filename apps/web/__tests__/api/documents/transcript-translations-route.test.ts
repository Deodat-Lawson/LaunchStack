/**
 * POST /api/documents/[id]/transcript/translations — a transcript's lines in
 * another language, translated once and then served from the document.
 */

import type * as MockRequireWorkspaceContext from "../../helpers/mock-require-workspace-context";
import type * as Conversion from "@launchstack/conversion/audio-transcription";

import { TranscriptionError } from "@launchstack/conversion";
import { POST } from "~/app/api/documents/[id]/transcript/translations/route";

import { makeWorkspaceContext } from "../../helpers/workspace-context";

const mockRequireWorkspaceContext = jest.fn();
jest.mock("~/lib/require-workspace-context", () =>
    jest
        .requireActual<
            typeof MockRequireWorkspaceContext
        >("../../helpers/mock-require-workspace-context")
        .workspaceContextModuleMock(() => mockRequireWorkspaceContext())
);

jest.mock("~/lib/authz/scope", () => ({ scopedDocumentWhere: () => ({}) }));
jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: (_request: Request, _config: unknown, handler: () => Promise<Response>) =>
        handler(),
}));
jest.mock("~/server/engine", () => ({ getEngine: jest.fn() }));

const mockFetchFile = jest.fn();
jest.mock("~/lib/storage", () => ({
    fetchFile: (...args: unknown[]) => mockFetchFile(...args) as unknown,
}));

const mockTranslate = jest.fn();
jest.mock("@launchstack/conversion/audio-transcription", () => {
    const actual = jest.requireActual<typeof Conversion>(
        "@launchstack/conversion/audio-transcription"
    );
    return {
        ...actual,
        translateTranscriptLines: (...args: unknown[]) => mockTranslate(...args) as unknown,
    };
});

const mockDbSelect = jest.fn();
const mockDbUpdate = jest.fn();
const mockSet = jest.fn();
jest.mock("~/server/db", () => ({
    db: {
        select: (...args: unknown[]) => mockDbSelect(...args) as unknown,
        update: (...args: unknown[]) => mockDbUpdate(...args) as unknown,
    },
}));

function selectReturns(rows: Record<string, unknown>[]) {
    mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(rows) }),
    });
}

const SEGMENTS = [
    { start: 0, end: 4, text: "大家好" },
    { start: 4, end: 9, text: "我哋開會" },
];

function transcript(
    ocrMetadata: Record<string, unknown> | null,
    title = "memo.m4a (Transcription)"
) {
    return { id: 3, title, url: "/api/files/3", ocrMetadata };
}

async function post(body: unknown, id = "3") {
    const response = await POST(
        new Request(`http://localhost/api/documents/${id}/transcript/translations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id }) }
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockRequireWorkspaceContext.mockResolvedValue({ success: true, data: makeWorkspaceContext() });
    mockDbUpdate.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) });
});

describe("POST /api/documents/[id]/transcript/translations", () => {
    it("translates the segments line for line and stores the result", async () => {
        selectReturns([
            transcript({ source: "transcription", language: "yue", segments: SEGMENTS }),
        ]);
        mockTranslate.mockResolvedValue({
            lines: ["Hello everyone", "We're meeting"],
            model: "gemini-3.8-flash",
            tokens: 50,
        });

        const { status, body } = await post({ language: "en" });

        expect(status).toBe(200);
        expect(body).toEqual({
            language: "en",
            lines: ["Hello everyone", "We're meeting"],
            cached: false,
        });
        expect(mockTranslate).toHaveBeenCalledWith(["大家好", "我哋開會"], "en");
        expect(mockDbUpdate).toHaveBeenCalledTimes(1);
    });

    it("serves a stored translation without calling the model", async () => {
        selectReturns([
            transcript({
                source: "transcription",
                segments: SEGMENTS,
                translations: {
                    en: { lines: ["Hi all", "Meeting"], model: "m", translatedAt: "t" },
                },
            }),
        ]);

        const { body } = await post({ language: "EN" });

        expect(body).toEqual({ language: "en", lines: ["Hi all", "Meeting"], cached: true });
        expect(mockTranslate).not.toHaveBeenCalled();
        expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it("translates a plain transcript by its lines, read from storage", async () => {
        selectReturns([transcript({ source: "transcription", language: "unknown" })]);
        mockFetchFile.mockResolvedValue(new Response("Hola a todos.\nEmpezamos.\n"));
        mockTranslate.mockResolvedValue({
            lines: ["Hello all.", "Let's start."],
            model: "m",
            tokens: 1,
        });

        const { body } = await post({ language: "en" });

        expect(mockFetchFile).toHaveBeenCalledWith("/api/files/3");
        expect(mockTranslate).toHaveBeenCalledWith(["Hola a todos.", "Empezamos."], "en");
        expect(body.lines).toEqual(["Hello all.", "Let's start."]);
    });

    it("refuses a document that is not a transcript", async () => {
        selectReturns([transcript(null, "Board deck.pdf")]);
        const { status } = await post({ language: "en" });
        expect(status).toBe(400);
        expect(mockTranslate).not.toHaveBeenCalled();
    });

    it("is 404 for a transcript outside the caller's scope", async () => {
        selectReturns([]);
        const { status } = await post({ language: "en" });
        expect(status).toBe(404);
    });

    it("refuses a language code that is not one", async () => {
        const { status } = await post({ language: "not a code!" });
        expect(status).toBe(400);
        expect(mockDbSelect).not.toHaveBeenCalled();
    });

    it("refuses a real language tag the menu does not offer, so readers cannot mint paid variants", async () => {
        for (const language of ["en-x-1", "en-GB", "tlh"]) {
            const { status } = await post({ language });
            expect(status).toBe(400);
        }
        expect(mockDbSelect).not.toHaveBeenCalled();
        expect(mockTranslate).not.toHaveBeenCalled();
    });

    it("accepts the menu's script-tagged Chinese in any case", async () => {
        selectReturns([transcript({ source: "transcription", segments: SEGMENTS })]);
        mockTranslate.mockResolvedValue({ lines: ["大家好", "我们开会"], model: "m", tokens: 1 });
        const { status, body } = await post({ language: "zh-hans" });
        expect(status).toBe(200);
        expect(body.language).toBe("zh-Hans");
    });

    it("passes on the reason a translation failed", async () => {
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
        selectReturns([transcript({ source: "transcription", segments: SEGMENTS })]);
        mockTranslate.mockRejectedValue(
            new TranscriptionError(
                "429",
                "The translation service is busy (rate limit). Try again in a minute.",
                502
            )
        );

        try {
            const { status, body } = await post({ language: "en" });
            expect(status).toBe(502);
            expect(body.error).toMatch(/busy/);
            expect(mockDbUpdate).not.toHaveBeenCalled();
        } finally {
            consoleErrorSpy.mockRestore();
        }
    });

    it("requires a workspace session", async () => {
        mockRequireWorkspaceContext.mockResolvedValue({
            success: false,
            response: Response.json({ error: "Unauthorized" }, { status: 401 }),
        });
        const { status } = await post({ language: "en" });
        expect(status).toBe(401);
    });
});
