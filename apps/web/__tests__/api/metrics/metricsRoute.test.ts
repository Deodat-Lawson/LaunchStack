import { GET } from "~/app/api/metrics/route";

const mockGetMetricsSnapshot = jest.fn();
const mockEnvServer = {
    METRICS_SCRAPE_TOKEN: undefined as string | undefined,
};

jest.mock("~/server/metrics/registry", () => ({
    getMetricsSnapshot: () => mockGetMetricsSnapshot() as Promise<string>,
    metricsRegistry: {
        contentType: "text/plain; version=0.0.4; charset=utf-8",
    },
}));

jest.mock("~/env", () => ({
    env: {
        get server() {
            return mockEnvServer;
        },
        client: {},
    },
}));

describe("GET /api/metrics", () => {
    const originalVercelEnv = process.env.VERCEL_ENV;

    beforeEach(() => {
        jest.clearAllMocks();
        mockEnvServer.METRICS_SCRAPE_TOKEN = undefined;
        delete process.env.VERCEL_ENV;
        mockGetMetricsSnapshot.mockResolvedValue("pdr_predictive_analysis_duration_seconds 1\n");
    });

    afterAll(() => {
        if (originalVercelEnv === undefined) {
            delete process.env.VERCEL_ENV;
        } else {
            process.env.VERCEL_ENV = originalVercelEnv;
        }
    });

    it("returns Prometheus metrics when no token is configured (non-production)", async () => {
        const response = await GET(new Request("http://localhost/api/metrics"));
        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toContain("text/plain");
        expect(await response.text()).toContain("pdr_predictive_analysis_duration_seconds");
    });

    it("returns 503 in production when scrape token is unset", async () => {
        process.env.VERCEL_ENV = "production";
        const response = await GET(new Request("http://localhost/api/metrics"));
        expect(response.status).toBe(503);
    });

    it("returns 401 when token is configured but Authorization is missing", async () => {
        mockEnvServer.METRICS_SCRAPE_TOKEN = "scrape-secret";
        const response = await GET(new Request("http://localhost/api/metrics"));
        expect(response.status).toBe(401);
    });

    it("returns metrics when Bearer token matches", async () => {
        mockEnvServer.METRICS_SCRAPE_TOKEN = "scrape-secret";
        const response = await GET(
            new Request("http://localhost/api/metrics", {
                headers: { Authorization: "Bearer scrape-secret" },
            })
        );
        expect(response.status).toBe(200);
        expect(await response.text()).toContain("pdr_predictive_analysis_duration_seconds");
    });
});
