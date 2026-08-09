import { POST } from "~/app/api/uploadDocument/route";
import { validateRequestBody } from "~/lib/validation";
import { db } from "~/server/db";
import { resolveActiveCompanyForUser } from "~/lib/active-workspace";
import {
    processDocumentUpload,
    type DocumentUploadResult,
} from "~/server/services/document-upload";

const mockClerk: { userId: string | null } = { userId: "user-1" };

jest.mock("@clerk/nextjs/server", () => ({
    auth: () => Promise.resolve({ userId: mockClerk.userId }),
}));

jest.mock("~/lib/validation", () => {
    const actual = jest.requireActual("~/lib/validation");
    return {
        ...actual,
        validateRequestBody: jest.fn(),
    };
});

// Pass rate limiting through — these tests exercise the handler, not the
// limiter. Mocking ~/lib/rate-limiter also keeps its in-memory store's
// cleanup setInterval from holding the Jest process open after the run.
jest.mock("~/lib/rate-limit-middleware", () => ({
    withRateLimit: jest.fn(
        async (
            _request: Request,
            _config: unknown,
            handler: () => Promise<unknown>,
        ) => handler(),
    ),
}));
jest.mock("~/lib/rate-limiter", () => ({
    RateLimitPresets: {
        standard: { maxRequests: 100, windowMs: 15 * 60 * 1000 },
        strict: { maxRequests: 20, windowMs: 15 * 60 * 1000 },
        permissive: { maxRequests: 300, windowMs: 15 * 60 * 1000 },
        burst: { maxRequests: 10, windowMs: 60 * 1000 },
    },
}));

jest.mock("~/server/db", () => ({
    db: {
        select: jest.fn(),
    },
}));

jest.mock("~/lib/active-workspace", () => ({
    resolveActiveCompanyForUser: jest.fn(),
}));

jest.mock("~/server/services/document-upload", () => ({
    processDocumentUpload: jest.fn(),
}));

type UploadResult = DocumentUploadResult;

const processDocumentUploadMock = processDocumentUpload as jest.MockedFunction<
    typeof processDocumentUpload
>;
const resolveActiveCompanyForUserMock = resolveActiveCompanyForUser as jest.MockedFunction<
    typeof resolveActiveCompanyForUser
>;

function mockUserLookup(user: { id: number; userId: string; companyId: bigint } | null) {
    const where = jest.fn().mockResolvedValue(user ? [user] : []);
    const from = jest.fn().mockReturnValue({ where });
    (db.select as jest.Mock).mockReturnValue({ from });
}

function mockValidRequest(data: Record<string, unknown>) {
    (validateRequestBody as jest.Mock).mockResolvedValue({
        success: true,
        data,
    });
}

function requestFor(body: Record<string, unknown>) {
    return new Request("http://localhost/api/uploadDocument", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

function mockUploadResult(overrides: Partial<UploadResult> = {}): UploadResult {
    return {
        jobId: "ocr-test-job",
        eventIds: ["event-1"],
        storageType: "s3",
        document: {
            id: 42,
            url: "https://example.com/doc.pdf",
            title: "Example Document",
            category: "contracts",
        },
        resolvedDocumentUrl: "https://example.com/doc.pdf",
        ...overrides,
    };
}

describe("POST /api/uploadDocument", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockClerk.userId = "user-1";
    });

    it("uploads and processes a document successfully", async () => {
        const body = {
            userId: "user-1",
            documentName: "Example Document",
            documentUrl: "https://example.com/doc.pdf",
            category: "contracts",
        };
        mockValidRequest(body);        mockUserLookup({ id: 101, userId: body.userId, companyId: 5n });
        resolveActiveCompanyForUserMock.mockResolvedValue(8n);

        const uploadResult = mockUploadResult({
            jobId: "ocr-test-job-123",
            eventIds: ["event-1", "event-2"],
            document: {
                id: 42,
                url: body.documentUrl,
                title: body.documentName,
                category: body.category,
            },
        });
        processDocumentUploadMock.mockResolvedValue(uploadResult);

        const response = await POST(requestFor(body));
        const json = await response.json();

        expect(response.status).toBe(202);
        expect(json).toMatchObject({
            success: true,
            jobId: uploadResult.jobId,
            eventIds: uploadResult.eventIds,
            message: "Document processing started",
            storageType: "s3",
            document: uploadResult.document,
        });
        expect(resolveActiveCompanyForUserMock).toHaveBeenCalledWith(101, 5n);
        expect(processDocumentUploadMock).toHaveBeenCalledWith(
            expect.objectContaining({
                user: { userId: body.userId, companyId: 8n },
                documentName: body.documentName,
                rawDocumentUrl: body.documentUrl,
                category: body.category,
                creationKey: `upload:${body.documentUrl}`,
                requestUrl: "http://localhost/api/uploadDocument",
            })
        );
    });

    it("handles document with preferred provider", async () => {
        const body = {
            userId: "user-1",
            documentName: "Example Document",
            documentUrl: "https://example.com/doc.pdf",
            category: "policies",
            preferredProvider: "azure",
        };
        mockValidRequest(body);        mockUserLookup({ id: 102, userId: body.userId, companyId: 9n });
        resolveActiveCompanyForUserMock.mockResolvedValue(14n);
        processDocumentUploadMock.mockResolvedValue(
            mockUploadResult({
                jobId: "ocr-test-job-456",
                eventIds: ["event-3"],
                document: {
                    id: 77,
                    url: body.documentUrl,
                    title: body.documentName,
                    category: body.category,
                },
            })
        );

        const response = await POST(requestFor(body));
        const json = await response.json();

        expect(response.status).toBe(202);
        expect(json).toMatchObject({
            success: true,
            jobId: "ocr-test-job-456",
            eventIds: ["event-3"],
            message: "Document processing started",
        });
        expect(processDocumentUploadMock).toHaveBeenCalledWith(
            expect.objectContaining({
                user: { userId: body.userId, companyId: 14n },
                preferredProvider: "azure",
                creationKey: `upload:${body.documentUrl}`,
            })
        );
    });

    it("returns 500 when document processing fails", async () => {
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
        const body = {
            userId: "user-2",
            documentName: "Broken Document",
            documentUrl: "https://example.com/broken.pdf",
            category: "finance",
        };
        const processingError = new Error("Inngest API Error: 401 Event key not found");

        try {
            mockClerk.userId = "user-2";
            mockValidRequest(body);
            mockUserLookup({ id: 103, userId: body.userId, companyId: 7n });
            resolveActiveCompanyForUserMock.mockResolvedValue(11n);
            processDocumentUploadMock.mockRejectedValue(processingError);

            const response = await POST(requestFor(body));
            const json = await response.json();

            expect(response.status).toBe(500);
            expect(json.error).toBe("Failed to start document processing");
            expect(processDocumentUploadMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    user: { userId: body.userId, companyId: 11n },
                    creationKey: `upload:${body.documentUrl}`,
                })
            );
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining("Error triggering document processing"),
                processingError
            );
        } finally {
            consoleErrorSpy.mockRestore();
        }
    });

    it("returns 400 when user is not found", async () => {
        const body = {
            userId: "invalid-user",
            documentName: "Example Document",
            documentUrl: "https://example.com/doc.pdf",
        };
        mockClerk.userId = "invalid-user";
        mockValidRequest(body);
        mockUserLookup(null);

        const response = await POST(requestFor(body));
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.error).toBe("Invalid user");
        expect(resolveActiveCompanyForUserMock).not.toHaveBeenCalled();
        expect(processDocumentUploadMock).not.toHaveBeenCalled();
    });

    it("returns 401 when there is no Clerk session", async () => {
        const body = {
            userId: "user-1",
            documentName: "Example Document",
            documentUrl: "https://example.com/doc.pdf",
        };
        mockClerk.userId = null;
        mockValidRequest(body);

        const response = await POST(requestFor(body));
        const json = await response.json();

        expect(response.status).toBe(401);
        expect(json.error).toBe("Unauthorized");
        expect(db.select).not.toHaveBeenCalled();
        expect(processDocumentUploadMock).not.toHaveBeenCalled();
    });

    it("ignores a body userId that differs from the session and logs the mismatch", async () => {
        const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const body = {
                userId: "someone-else",
                documentName: "Example Document",
                documentUrl: "https://example.com/doc.pdf",
            };
            mockClerk.userId = "user-1";
            mockValidRequest(body);
            mockUserLookup({ id: 101, userId: "user-1", companyId: 5n });
            resolveActiveCompanyForUserMock.mockResolvedValue(5n);
            processDocumentUploadMock.mockResolvedValue(mockUploadResult());

            const response = await POST(requestFor(body));

            expect(response.status).toBe(202);
            expect(processDocumentUploadMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    user: { userId: "user-1", companyId: 5n },
                })
            );
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining("Ignoring body userId=someone-else")
            );
        } finally {
            consoleWarnSpy.mockRestore();
        }
    });

    it("returns validation response when request body is invalid", async () => {
        const validationResponse = new Response(JSON.stringify({ error: "Invalid request" }), {
            status: 400,
        });
        (validateRequestBody as jest.Mock).mockResolvedValue({
            success: false,
            response: validationResponse,
        });

        const response = await POST(requestFor({}));
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json).toEqual({ error: "Invalid request" });
        expect(db.select).not.toHaveBeenCalled();
        expect(resolveActiveCompanyForUserMock).not.toHaveBeenCalled();
        expect(processDocumentUploadMock).not.toHaveBeenCalled();
    });
});
