import { simulateVantage } from "~/app/dev/vantage/simulator";
import { resetWeeklyReviewFixture } from "~/app/dev/vantage/weekly-review-fixture";
import { readWeeklyReviewStream } from "~/app/employer/tools/vantage/api";
import type { WeeklyReviewDto } from "~/server/vantage/weekly-review-client-types";
import { createHash } from "node:crypto";
async function request(
    path: string,
    method = "GET",
    body?: object,
    headers?: Record<string, string>,
    admin = true
) {
    const response = await simulateVantage(
        new URL(`/api/vantage/${path}`, "http://preview.local"),
        { method, ...(body ? { body: JSON.stringify(body) } : {}), headers },
        admin
    );
    if (!response) throw Error(`Not intercepted: ${path}`);
    return response;
}
async function current(): Promise<WeeklyReviewDto> {
    const list = await (await request("reviews")).json();
    return (await request(`reviews/${list.activeId ?? list.runs[0].id}`)).json();
}
beforeEach(() => {
    jest.useFakeTimers({ now: new Date("2026-11-16T12:00:00Z") });
    resetWeeklyReviewFixture();
});
afterEach(() => jest.useRealTimers());
test("read, evidence and support routes work without login; obsolete routes are absent", async () => {
    const run = await current();
    expect(run.report.topics).toHaveLength(3);
    expect(run.decisions).toEqual([]);
    expect(run.evidence.qualityEvidence).toBe("injected-deterministic");
    const source = run.evidence.inputSnapshot!.sources[0]!;
    expect(
        await (
            await request(`reviews/${run.id}/evidence?ref=${encodeURIComponent(source.ref)}`)
        ).json()
    ).toMatchObject({ ...source, authorization: "current" });
    for (const path of [
        "reviews/context",
        "reviews/context/role",
        "evidence",
        "metrics",
        "commitments",
        "triage",
        "deadlines",
        "overview",
    ])
        expect((await request(path)).status).toBe(200);
    for (const path of ["agendas", "topics/tp_1"]) expect((await request(path)).status).toBe(404);
});
test("decisions append versions, retry idempotently and reject stale writes", async () => {
    const run = await current();
    const input = {
        expectedVersion: run.version,
        topicId: run.report.topics[0]!.id,
        decision: "Do discovery first",
    };
    const headers = { "Idempotency-Key": "decision-1" };
    expect((await request(`reviews/${run.id}/decisions`, "POST", input, headers)).status).toBe(200);
    expect((await request(`reviews/${run.id}/decisions`, "POST", input, headers)).status).toBe(200);
    expect((await request(`reviews/${run.id}/decisions`, "POST", input)).status).toBe(409);
    expect((await current()).decisions).toHaveLength(1);
    await request(`reviews/${run.id}/decisions`, "POST", {
        ...input,
        expectedVersion: 2,
        decision: "Limit discovery to three calls",
    });
    expect((await current()).decisions.map(d => d.decision)).toEqual([
        input.decision,
        "Limit discovery to three calls",
    ]);
});
test("generation emits actual operations, persists its result and supports JSON plus NDJSON retries", async () => {
    const run = await current();
    const stages: string[] = [];
    const input = { weekStart: "2026-11-16", expectedActiveId: run.id };
    const headers = { Accept: "application/x-ndjson", "Idempotency-Key": "generate-1" };
    const completed = readWeeklyReviewStream(await request("reviews", "POST", input, headers), s =>
        stages.push(s)
    );
    await jest.advanceTimersByTimeAsync(0);
    expect(stages).toEqual(["gathering"]);
    expect((await current()).id).toBe(run.id);
    await jest.advanceTimersByTimeAsync(1199);
    expect(stages).toEqual(["gathering"]);
    await jest.advanceTimersByTimeAsync(1);
    expect(stages).toEqual(["gathering", "writing"]);
    await jest.advanceTimersByTimeAsync(1200);
    expect(stages).toEqual(["gathering", "writing", "checking"]);
    await jest.advanceTimersByTimeAsync(1200);
    expect(stages).toEqual(["gathering", "writing", "checking", "saving"]);
    expect((await current()).id).toBe(run.id);
    await jest.advanceTimersByTimeAsync(1199);
    expect((await current()).id).toBe(run.id);
    await jest.advanceTimersByTimeAsync(1);
    const result = await completed;
    expect(result.id).not.toBe(run.id);
    expect((await current()).id).toBe(result.id);
    expect(result.decisions).toEqual([]);
    expect(
        (await readWeeklyReviewStream(await request("reviews", "POST", input, headers))).id
    ).toBe(result.id);
    expect(
        (await request("reviews", "POST", { ...input, expectedActiveId: result.id })).status
    ).toBe(201);
});
test("stream and JSON map stale pointers consistently", async () => {
    const stages: string[] = [];
    const input = { weekStart: "2026-11-16", expectedActiveId: "stale" };
    const rejected = expect(
        readWeeklyReviewStream(
            await request("reviews", "POST", input, { Accept: "application/x-ndjson" }),
            s => stages.push(s)
        )
    ).rejects.toMatchObject({ message: "active_review_changed", status: 409 });
    await jest.runAllTimersAsync();
    await rejected;
    expect(stages).toEqual(["gathering"]);
    expect((await request("reviews", "POST", input)).status).toBe(409);
});
test("preview latency retains the final active-pointer check before saving", async () => {
    const prior = await current();
    const input = { weekStart: "2026-11-16", expectedActiveId: prior.id };
    const stages: string[] = [];
    const completed = readWeeklyReviewStream(
        await request("reviews", "POST", input, {
            Accept: "application/x-ndjson",
            "Idempotency-Key": "slow-generation",
        }),
        stage => stages.push(stage)
    );
    const rejected = expect(completed).rejects.toMatchObject({
        message: "active_review_changed",
        status: 409,
    });
    await jest.advanceTimersByTimeAsync(3600);
    expect(stages).toEqual(["gathering", "writing", "checking", "saving"]);
    const replacement: WeeklyReviewDto = await (
        await request("reviews", "POST", input, { "Idempotency-Key": "other-generation" })
    ).json();
    await jest.advanceTimersByTimeAsync(1200);
    await rejected;
    expect((await current()).id).toBe(replacement.id);
});
test("policy, stars, confirmed roles and versioned source previews enforce configuration semantics", async () => {
    expect(
        (
            await request(
                "reviews/context",
                "POST",
                { expectedVersion: 1, architectureDocumentId: "101", requiredDocumentIds: ["102"] },
                undefined,
                false
            )
        ).status
    ).toBe(403);
    expect(
        (
            await request(
                "reviews/context",
                "PATCH",
                { expectedVersion: 1, starDocumentIds: ["104"] },
                undefined,
                false
            )
        ).status
    ).toBe(200);
    expect(
        (await request("reviews/context", "PATCH", { expectedVersion: 1, starDocumentIds: [] }))
            .status
    ).toBe(409);
    expect(
        (
            await request(
                "reviews/context/source?documentId=104&purpose=personal-star&version=1",
                "GET",
                undefined,
                undefined,
                false
            )
        ).status
    ).toBe(200);
    const preview = await (
        await request("reviews/context/source?documentId=102&purpose=workspace-required&version=1")
    ).json();
    expect(preview.preview.text).toContain("162 teams");
    expect(preview.preview.parentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(
        (
            await request(
                "reviews/context/source?documentId=102&purpose=workspace-required&version=2"
            )
        ).status
    ).toBe(409);
    const input = {
        expectedVersion: 0,
        primaryRole: "CEO",
        responsibilities: ["Customer discovery"],
        priorities: ["Activation"],
        confirmed: true,
    };
    expect((await request("reviews/context/role", "PATCH", input)).status).toBe(200);
    expect((await (await request("reviews/context/role")).json()).role.primaryRole).toBe("CEO");
    expect((await request("reviews/context/role", "PATCH", input)).status).toBe(409);
    expect(
        (await request("reviews/context/role", "PATCH", { expectedVersion: 1, role: null })).status
    ).toBe(200);
});
test("explicit commitment creation persists to subsequent reads", async () => {
    const before = await (await request("commitments")).json();
    const response = await request("commitments", "POST", {
        title: "Interview stalled teams",
        owner: "Maya",
        dueOn: "2026-11-20",
    });
    expect(response.status).toBe(201);
    const created = await response.json();
    const after = await (await request("commitments")).json();
    expect(after.commitments).toHaveLength(before.commitments.length + 1);
    expect(after.commitments).toContainEqual({ ...created.commitment, canEdit: true });
});

test("configured scopes freeze exact excerpts and return their range and coverage", async () => {
    const inspection = await (
        await request("reviews/context/source?documentId=102&purpose=workspace-required&version=1")
    ).json();
    const text = inspection.preview.text.slice(0, 40);
    const scope = {
        version: "1",
        expectedParentHash: inspection.preview.parentHash,
        qualification: "Activation counts only",
        requiredUnits: [
            {
                id: "counts",
                start: 0,
                end: 40,
                excerptHash: createHash("sha256").update(text).digest("hex"),
            },
        ],
    };
    expect(
        (
            await request("reviews/context", "POST", {
                expectedVersion: 1,
                architectureDocumentId: "101",
                requiredDocumentIds: ["102", "103"],
                requiredSourceScopes: { "102": scope },
            })
        ).status
    ).toBe(200);
    const prior = await current();
    const response = await request("reviews", "POST", {
        weekStart: "2026-11-16",
        expectedActiveId: prior.id,
    });
    expect(response.status).toBe(201);
    const result: WeeklyReviewDto = await response.json();
    const ref = result.report.topics[0]!.facts[0]!.refs[0]!;
    expect(ref).toMatch(/^unit:[a-f0-9]{64}$/);
    const evidence = await (await request(`reviews/${result.id}/evidence?ref=${ref}`)).json();
    expect(evidence).toMatchObject({
        text,
        hash: scope.requiredUnits[0]!.excerptHash,
        scope: { start: 0, end: 40, coverage: { state: "relevant_spans_reviewed" } },
    });
    expect(
        (await request("reviews", "POST", { weekStart: "2026-11-17", expectedActiveId: result.id }))
            .status
    ).toBe(400);
});
