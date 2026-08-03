import { GET } from "~/app/api/files/[id]/route";
import { signFileAccessToken } from "@launchstack/core/crypto";
import type {
  WorkspaceContext,
  WorkspaceContextResult,
} from "~/lib/require-workspace-context";

const SECRET = "route-file-access-secret";

const mockRequireWorkspaceContext = jest.fn<Promise<WorkspaceContextResult>, []>();

jest.mock("~/lib/require-workspace-context", () => ({
  requireWorkspaceContext: () => mockRequireWorkspaceContext(),
}));

jest.mock("~/env", () => ({
  env: {
    server: { FILE_ACCESS_TOKEN_SECRET: "route-file-access-secret" },
    client: {},
  },
}));

const mockDbSelect = jest.fn();

jest.mock("~/server/db", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args) as unknown,
  },
}));

jest.mock("~/server/storage/vercel-blob", () => ({
  isPrivateBlobUrl: () => false,
}));

jest.mock("~/lib/storage", () => ({
  fetchFile: jest.fn(),
}));

const DB_FILE = {
  id: 123,
  userId: "clerk_abc",
  companyId: BigInt(5),
  filename: "notes.txt",
  mimeType: "text/plain",
  storageProvider: "database",
  storageUrl: null,
  fileData: Buffer.from("hello worker").toString("base64"),
};

const DB_FILE_LEGACY = {
  ...DB_FILE,
  companyId: null,
};

const VERIFIED_DATA: WorkspaceContext = {
  clerkUserId: "clerk_abc",
  userPk: BigInt(7),
  companyId: BigInt(5),
  role: "employer",
  status: "verified",
};

const VERIFIED_CTX = {
  success: true as const,
  data: VERIFIED_DATA,
};

function mockAuthenticated(overrides?: Partial<WorkspaceContext>) {
  const data = { ...VERIFIED_DATA, ...overrides };
  mockRequireWorkspaceContext.mockResolvedValue({ success: true, data });
}

function mockUnauthenticated() {
  mockRequireWorkspaceContext.mockResolvedValue({
    success: false,
    response: new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }),
  } as WorkspaceContextResult);
}

function setupFileQuery(rows: Record<string, unknown>[]) {
  const where = jest.fn().mockResolvedValue(rows);
  const from = jest.fn().mockReturnValue({ where });
  mockDbSelect.mockReturnValueOnce({ from });
}

function request(path: string) {
  return new Request(`http://localhost${path}`);
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/files/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUnauthenticated();
  });

  it("returns 401 for an anonymous request with no token", async () => {
    const response = await GET(request("/api/files/123"), params("123"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("serves the file to a signed-in user who owns it", async () => {
    mockAuthenticated();
    setupFileQuery([DB_FILE]);

    const response = await GET(request("/api/files/123"), params("123"));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello worker");
  });

  it("returns 404 when file belongs to a different company", async () => {
    mockAuthenticated({ companyId: BigInt(999) });
    setupFileQuery([DB_FILE]);

    const response = await GET(request("/api/files/123"), params("123"));

    expect(response.status).toBe(404);
  });

  it("returns 404 for a row with no company stamp", async () => {
    mockAuthenticated();
    setupFileQuery([DB_FILE_LEGACY]);

    const response = await GET(request("/api/files/123"), params("123"));

    expect(response.status).toBe(404);
    expect(mockDbSelect).toHaveBeenCalledTimes(1);
  });

  it("serves the file to a caller holding a valid token (skips ownership)", async () => {
    const token = signFileAccessToken("123", SECRET);
    setupFileQuery([DB_FILE]);

    const response = await GET(
      request(`/api/files/123?t=${token}`),
      params("123"),
    );

    expect(response.status).toBe(200);
    expect(mockRequireWorkspaceContext).not.toHaveBeenCalled();
  });

  it("rejects a token minted for a different file", async () => {
    const token = signFileAccessToken("999", SECRET);

    const response = await GET(
      request(`/api/files/123?t=${token}`),
      params("123"),
    );

    expect(response.status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const token = signFileAccessToken("123", SECRET, {
      ttlMs: 1000,
      now: Date.now() - 5000,
    });

    const response = await GET(
      request(`/api/files/123?t=${token}`),
      params("123"),
    );

    expect(response.status).toBe(401);
  });

  it("returns 400 for a non-numeric id", async () => {
    const response = await GET(request("/api/files/abc"), params("abc"));

    expect(response.status).toBe(400);
  });

  it("returns 404 when the file row is missing", async () => {
    mockAuthenticated();
    setupFileQuery([]);

    const response = await GET(request("/api/files/123"), params("123"));

    expect(response.status).toBe(404);
  });
});
