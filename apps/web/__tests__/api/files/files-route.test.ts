import { GET } from "~/app/api/files/[id]/route";
import { signFileAccessToken } from "@launchstack/core/crypto";

const SECRET = "route-file-access-secret";

const mockAuth = jest.fn<Promise<{ userId: string | null }>, []>();

jest.mock("@clerk/nextjs/server", () => ({
  auth: () => mockAuth(),
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
  filename: "notes.txt",
  mimeType: "text/plain",
  storageProvider: "database",
  storageUrl: null,
  fileData: Buffer.from("hello worker").toString("base64"),
};

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
    mockAuth.mockResolvedValue({ userId: null });
  });

  it("returns 401 for an anonymous request with no token", async () => {
    const response = await GET(request("/api/files/123"), params("123"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it("serves the file to a signed-in user", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_abc" });
    setupFileQuery([DB_FILE]);

    const response = await GET(request("/api/files/123"), params("123"));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello worker");
  });

  it("serves the file to a caller holding a valid token for that file", async () => {
    const token = signFileAccessToken("123", SECRET);
    setupFileQuery([DB_FILE]);

    const response = await GET(
      request(`/api/files/123?t=${token}`),
      params("123"),
    );

    expect(response.status).toBe(200);
    expect(mockAuth).not.toHaveBeenCalled();
  });

  it("rejects a token minted for a different file", async () => {
    const token = signFileAccessToken("999", SECRET);

    const response = await GET(
      request(`/api/files/123?t=${token}`),
      params("123"),
    );

    expect(response.status).toBe(401);
    expect(mockDbSelect).not.toHaveBeenCalled();
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

  it("returns 400 for a non-numeric id without touching auth", async () => {
    const response = await GET(request("/api/files/abc"), params("abc"));

    expect(response.status).toBe(400);
    expect(mockAuth).not.toHaveBeenCalled();
  });

  it("returns 404 when the file row is missing", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_abc" });
    setupFileQuery([]);

    const response = await GET(request("/api/files/123"), params("123"));

    expect(response.status).toBe(404);
  });
});
