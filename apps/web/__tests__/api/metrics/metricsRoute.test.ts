import { GET } from "~/app/api/metrics/route";
import { __resetMetricsAuthWarningForTests } from "~/server/security/metrics-auth";

const TOKEN = "prometheus-scrape-token";

function requestFor(headers: Record<string, string> = {}) {
    return new Request("http://localhost/api/metrics", { headers });
}

describe("GET /api/metrics", () => {
    beforeEach(() => {
        delete process.env.METRICS_BEARER_TOKEN;
        __resetMetricsAuthWarningForTests();
    });

    afterAll(() => {
        delete process.env.METRICS_BEARER_TOKEN;
    });

    it("returns Prometheus metrics in text format when no token is configured (legacy-open)", async () => {
        const response = await GET(requestFor());
        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toContain("text/plain");

        const body = await response.text();
        expect(body).toContain("pdr_predictive_analysis_duration_seconds");
    });

    it("warns exactly once when serving in legacy-open mode", async () => {
        const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
        try {
            await GET(requestFor());
            await GET(requestFor());

            const securityWarnings = warnSpy.mock.calls.filter(call =>
                String(call[0]).includes("METRICS_BEARER_TOKEN")
            );
            expect(securityWarnings).toHaveLength(1);
        } finally {
            warnSpy.mockRestore();
        }
    });

    describe("with METRICS_BEARER_TOKEN configured", () => {
        beforeEach(() => {
            process.env.METRICS_BEARER_TOKEN = TOKEN;
        });

        it("rejects requests without an Authorization header", async () => {
            const response = await GET(requestFor());
            expect(response.status).toBe(401);
        });

        it("rejects requests with the wrong bearer token", async () => {
            const response = await GET(requestFor({ Authorization: "Bearer wrong" }));
            expect(response.status).toBe(401);
        });

        it("serves metrics with the correct bearer token", async () => {
            const response = await GET(requestFor({ Authorization: `Bearer ${TOKEN}` }));
            expect(response.status).toBe(200);
            const body = await response.text();
            expect(body).toContain("pdr_predictive_analysis_duration_seconds");
        });
    });
});
