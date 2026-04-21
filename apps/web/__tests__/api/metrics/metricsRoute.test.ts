import { GET } from "~/app/api/metrics/route";

describe("GET /api/metrics", () => {
    it("returns Prometheus metrics in text format", async () => {
        const response = await GET();
        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toContain("text/plain");

        const body = await response.text();
        expect(body).toContain("pdr_predictive_analysis_duration_seconds");
    });
});
