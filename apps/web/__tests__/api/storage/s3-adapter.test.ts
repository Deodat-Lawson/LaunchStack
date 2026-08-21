const mockSend = jest.fn();
const mockS3ClientCtor = jest.fn();

class MockCommand {
  public readonly input: unknown;

  constructor(input: unknown) {
    this.input = input;
  }
}

jest.mock("@aws-sdk/client-s3", () => {
  mockS3ClientCtor.mockImplementation((config: unknown) => ({
    send: mockSend,
    __config: config,
  }));

  return {
    S3Client: mockS3ClientCtor,
    PutObjectCommand: MockCommand,
    GetObjectCommand: MockCommand,
    DeleteObjectCommand: MockCommand,
    DeleteObjectsCommand: MockCommand,
    CreateBucketCommand: MockCommand,
    HeadBucketCommand: MockCommand,
    ListObjectsV2Command: MockCommand,
  };
});

jest.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: jest.fn(),
}));

jest.mock("~/env", () => ({
  env: {
    server: {
      NEXT_PUBLIC_S3_ENDPOINT: "http://fallback:8333",
      S3_PUBLIC_ENDPOINT: undefined,
      S3_REGION: "us-east-1",
      S3_ACCESS_KEY: "fallback-key",
      S3_SECRET_KEY: "fallback-secret",
      S3_BUCKET_NAME: "fallback-bucket",
    },
    client: {
      NEXT_PUBLIC_S3_ENDPOINT: "http://fallback:8333",
    },
  },
}));

const originalEnv = process.env;

describe("S3StorageAdapter", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...originalEnv };

    delete process.env.STORAGE_S3_ENDPOINT;
    delete process.env.STORAGE_S3_PUBLIC_ENDPOINT;
    delete process.env.STORAGE_S3_REGION;
    delete process.env.STORAGE_S3_ACCESS_KEY;
    delete process.env.STORAGE_S3_SECRET_KEY;
    delete process.env.STORAGE_S3_BUCKET_NAME;
    delete process.env.STORAGE_S3_FORCE_PATH_STYLE;
    delete process.env.STORAGE_S3_ENSURE_BUCKET_EXISTS;
    delete process.env.NEXT_PUBLIC_S3_ENDPOINT;
    delete process.env.S3_PUBLIC_ENDPOINT;
    delete process.env.S3_REGION;
    delete process.env.S3_ACCESS_KEY;
    delete process.env.S3_SECRET_KEY;
    delete process.env.S3_BUCKET_NAME;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("builds Seaweed-style path URLs and trims trailing slashes", async () => {
    process.env.STORAGE_S3_ENDPOINT = "http://localhost:8333/";
    process.env.STORAGE_S3_BUCKET_NAME = "pdr-documents";
    process.env.STORAGE_S3_ACCESS_KEY = "seaweed-key";
    process.env.STORAGE_S3_SECRET_KEY = "seaweed-secret";

    const { getS3StorageAdapter } = await import("~/server/storage/adapters/s3-adapter");
    const adapter = getS3StorageAdapter();

    expect(adapter.getObjectUrl("documents/test.pdf")).toBe(
      "http://localhost:8333/pdr-documents/documents/test.pdf",
    );
  });

  it("keeps path-style URL minting when virtual-hosted requests are enabled", async () => {
    process.env.STORAGE_S3_ENDPOINT = "https://s3.example.com";
    process.env.STORAGE_S3_BUCKET_NAME = "tenant-a";
    process.env.STORAGE_S3_ACCESS_KEY = "key";
    process.env.STORAGE_S3_SECRET_KEY = "secret";
    process.env.STORAGE_S3_FORCE_PATH_STYLE = "false";

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    const { getS3StorageAdapter } = await import("~/server/storage/adapters/s3-adapter");
    const adapter = getS3StorageAdapter();

    expect(adapter.getObjectUrl("docs/a.pdf")).toBe("https://s3.example.com/tenant-a/docs/a.pdf");
    expect(adapter.getObjectUrl("docs/b.pdf")).toBe("https://s3.example.com/tenant-a/docs/b.pdf");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("path-style URLs");

    warnSpy.mockRestore();
  });

  it("passes forcePathStyle=true to S3Client by default", async () => {
    process.env.STORAGE_S3_ENDPOINT = "http://localhost:8333";
    process.env.STORAGE_S3_BUCKET_NAME = "bucket";
    process.env.STORAGE_S3_ACCESS_KEY = "key";
    process.env.STORAGE_S3_SECRET_KEY = "secret";

    const { getS3StorageAdapter } = await import("~/server/storage/adapters/s3-adapter");
    const adapter = getS3StorageAdapter();

    adapter.getClient();

    expect(mockS3ClientCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "http://localhost:8333",
        forcePathStyle: true,
      }),
    );
  });

  it("passes forcePathStyle=false to S3Client when configured", async () => {
    process.env.STORAGE_S3_ENDPOINT = "https://s3.example.com";
    process.env.STORAGE_S3_BUCKET_NAME = "bucket";
    process.env.STORAGE_S3_ACCESS_KEY = "key";
    process.env.STORAGE_S3_SECRET_KEY = "secret";
    process.env.STORAGE_S3_FORCE_PATH_STYLE = "false";

    const { getS3StorageAdapter } = await import("~/server/storage/adapters/s3-adapter");
    const adapter = getS3StorageAdapter();

    adapter.getClient();

    expect(mockS3ClientCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "https://s3.example.com",
        forcePathStyle: false,
      }),
    );
  });

  it("supports Seaweed-style public gateway endpoints with path prefixes", async () => {
    process.env.STORAGE_S3_ENDPOINT = "http://seaweedfs:8333";
    process.env.STORAGE_S3_PUBLIC_ENDPOINT = "https://cdn.example.com/objects/";
    process.env.STORAGE_S3_BUCKET_NAME = "launchstack-docs";
    process.env.STORAGE_S3_ACCESS_KEY = "key";
    process.env.STORAGE_S3_SECRET_KEY = "secret";

    const { getS3StorageAdapter } = await import("~/server/storage/adapters/s3-adapter");
    const adapter = getS3StorageAdapter();

    expect(adapter.getObjectUrl("documents/demo.txt")).toBe(
      "https://cdn.example.com/objects/launchstack-docs/documents/demo.txt",
    );
  });
});
