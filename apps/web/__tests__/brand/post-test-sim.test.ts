/**
 * Post tests in the /dev/growth harness: a draft run past simulated readers
 * finishes after a few polls, a finished test of the same text is linked to
 * the post it went out as, an edited draft is reported stale, and the track
 * record only compares once enough tested posts have real numbers.
 */
import { configureBrandSim, resetBrandSim, simulateBrand } from "~/app/dev/growth/brand-sim";
import { spearman } from "~/app/dev/growth/post-test-sim";
import type { BrandPost } from "~/app/employer/tools/growth/brand/api";
import type { PostTestLink, PostTestResult, TrackRecord } from "~/lib/scenarios/types";

jest.setTimeout(20_000);

async function call<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
    const response = await simulateBrand(new URL(path, "http://harness.local"), init, Date.now());
    if (!response) throw new Error(`no answer for ${path}`);
    return { status: response.status, body: (await response.json()) as T };
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

const DRAFT = "Invoices now send themselves on the first of the month. Turn it on in Settings.";

async function finishedTest(text = DRAFT): Promise<PostTestResult> {
    const started = await call<{ test: PostTestResult }>(
        "/api/brand/post-tests",
        post({ text, networks: ["linkedin"] })
    );
    expect(started.status).toBe(201);
    let test = started.body.test;
    for (let i = 0; i < 12 && test.status !== "done"; i++) {
        test = (await call<{ test: PostTestResult }>(`/api/brand/post-tests/${test.runId}`)).body
            .test;
    }
    return test;
}

beforeEach(() => resetBrandSim());

describe("post tests in the harness", () => {
    it("walks through the stages and finishes with a reception and sample comments", async () => {
        const started = await call<{ test: PostTestResult }>(
            "/api/brand/post-tests",
            post({ text: DRAFT, networks: ["linkedin"] })
        );
        expect(started.body.test).toMatchObject({ status: "queued", rounds: 3, reception: null });
        const seen = new Set<string>();
        let test = started.body.test;
        while (test.status !== "done") {
            test = (await call<{ test: PostTestResult }>(`/api/brand/post-tests/${test.runId}`))
                .body.test;
            seen.add(test.stage);
        }
        expect([...seen]).toEqual(["gathering", "casting", "simulating", "reporting", "done"]);
        expect(test.reception).toMatchObject({ exposed: 20 });
        expect(test.reception!.engaged).toBeLessThanOrEqual(20);
        expect(test.headline).toBeTruthy();
        expect(test.sampleComments.length).toBeGreaterThan(0);
        expect(test.sampleComments.length).toBeLessThanOrEqual(5);
        expect(test.text).toBe(DRAFT);
    });

    it("refuses an empty draft, a Viewer (403) and a short balance (402)", async () => {
        expect(
            (await call("/api/brand/post-tests", post({ text: "  ", networks: [] }))).status
        ).toBe(400);
        configureBrandSim({ canPublish: false });
        expect(
            (await call("/api/brand/post-tests", post({ text: DRAFT, networks: [] }))).status
        ).toBe(403);
        configureBrandSim({ canPublish: true, broke: true });
        const broke = await call<{ code: string }>(
            "/api/brand/post-tests",
            post({ text: DRAFT, networks: [] })
        );
        expect(broke.status).toBe(402);
        expect(broke.body.code).toBe("insufficient_credits");
    });

    it("links a finished test of the same text to the post, and reports an edited draft stale", async () => {
        const test = await finishedTest();
        const before = (await call<{ record: TrackRecord }>("/api/brand/post-tests/track-record"))
            .body.record;
        const linked = await call<{ posts: BrandPost[]; postTest: PostTestLink }>(
            "/api/brand/posts",
            post({ channels: ["ch-li-launchstack"], body: `  ${DRAFT}\n`, postTestId: test.runId })
        );
        expect(linked.status).toBe(201);
        expect(linked.body.postTest).toEqual({ runId: test.runId, linked: true, stale: false });
        const after = (await call<{ record: TrackRecord }>("/api/brand/post-tests/track-record"))
            .body.record;
        expect(after.tested).toBe(before.tested + 1);
        const row = after.rows.find(r => r.runId === test.runId)!;
        expect(row).toMatchObject({ postId: linked.body.posts[0]!.id, actual: null });
        expect(typeof row.postId).toBe("string");

        const stale = await call<{ postTest: PostTestLink }>(
            "/api/brand/posts",
            post({
                channels: ["ch-li-launchstack"],
                body: `${DRAFT} Edited.`,
                postTestId: test.runId,
            })
        );
        expect(stale.body.postTest).toEqual({ runId: test.runId, linked: false, stale: true });

        const plain = await call<Record<string, unknown>>(
            "/api/brand/posts",
            post({ channels: ["ch-li-launchstack"], body: DRAFT })
        );
        expect(plain.body).not.toHaveProperty("postTest");
    });

    it("compares only once enough tested posts have real numbers", async () => {
        const full = (await call<{ record: TrackRecord }>("/api/brand/post-tests/track-record"))
            .body.record;
        expect(full.rows).toHaveLength(7);
        expect(full.withResults).toBe(6);
        expect(full.withResults).toBeGreaterThanOrEqual(full.minimum);
        expect(full.spearman).not.toBeNull();
        expect(full.total).toBe(6);
        expect(full.hits).toBeLessThanOrEqual(full.total);
        expect(full.rows.some(r => r.actual === null)).toBe(true);

        configureBrandSim({ fewTests: true });
        const few = (await call<{ record: TrackRecord }>("/api/brand/post-tests/track-record")).body
            .record;
        expect(few.withResults).toBeLessThan(few.minimum);
        expect(few.spearman).toBeNull();
    });

    it("computes Spearman's rho on ranks", () => {
        expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
        expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1);
        expect(spearman([1, 2, 3], [5, 5, 5])).toBe(0);
    });
});
