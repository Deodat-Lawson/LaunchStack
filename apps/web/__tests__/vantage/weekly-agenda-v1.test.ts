import { webcrypto } from "node:crypto";
import { vantageApi } from "~/app/employer/tools/vantage/api";
import { ContractSimulator } from "~/app/dev/vantage/contractSimulator";
import {
    defaultReportingWeek,
    mondayOf,
    reportingDate,
    validReportingDate,
    calendarAdd,
} from "~/app/employer/tools/vantage/_lib/reporting";
import { completeDecision } from "~/app/employer/tools/vantage/_lib/submission";

Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
const originalFetch = globalThis.fetch;
let sim: ContractSimulator;
beforeEach(() => {
    sim = new ContractSimulator();
    completeDecision("topic-demo-1");
    globalThis.fetch = jest.fn(async (input, init) => {
        const result = await sim.respond(
            new URL(
                typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
                "http://localhost"
            ),
            init
        );
        if (!result) throw new Error("Unexpected request");
        return result;
    });
});
afterAll(() => {
    globalThis.fetch = originalFetch;
});

describe("v1 frontend reporting dates", () => {
    it("uses the prior complete week on Monday and current week on Tuesday in New York", () => {
        expect(defaultReportingWeek(new Date("2026-10-19T16:00:00Z"))).toBe("2026-10-12");
        expect(defaultReportingWeek(new Date("2026-10-20T16:00:00Z"))).toBe("2026-10-19");
        expect(reportingDate(new Date("2026-10-20T02:00:00Z"))).toBe("2026-10-19");
        expect(defaultReportingWeek(new Date("2026-10-20T02:00:00Z"))).toBe("2026-10-12");
    });
    it("keeps calendar navigation correct through DST and rejects impossible dates", () => {
        expect(calendarAdd("2026-11-01", 1)).toBe("2026-11-02");
        expect(mondayOf("2026-11-01")).toBe("2026-10-26");
        expect(validReportingDate("2026-02-30")).toBe(false);
        expect(validReportingDate("2024-02-29")).toBe(true);
    });
});

describe("v1 API transport", () => {
    it("includes a positive expected content version on every topic patch", async () => {
        const fetchMock = jest.fn().mockResolvedValue(
            new Response(JSON.stringify({ topic: {} }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            })
        );
        globalThis.fetch = fetchMock as typeof fetch;

        await vantageApi.patchTopic("topic-demo-1", { title: "A founder's wording" }, 4);

        const init = fetchMock.mock.calls[0]![1] as RequestInit;
        expect(typeof init.body).toBe("string");
        if (typeof init.body !== "string") throw new Error("Expected a JSON request body");
        expect(JSON.parse(init.body)).toMatchObject({ expectedContentVersion: 4 });
    });

    it("reads a missing week without generating anything", async () => {
        const result = await vantageApi.agendas("2026-10-05");
        expect(result.agenda).toBeNull();
        expect(sim.requests.map(r => r.method)).toEqual(["GET"]);
    });
    it("sends the selected mode and receives saved v1 metadata", async () => {
        const result = await vantageApi.prepare("2026-10-12", "rules");
        expect(result.agenda.execution).toMatchObject({ mode: "rules", fallbackReason: null });
        expect(result.agenda.reportPeriod?.timeZone).toBe("America/New_York");
    });
    it("renders historic fixture boundaries using the correct New York offset", async () => {
        const { agenda } = await vantageApi.prepare("2026-03-02", "rules");
        expect(agenda.reportPeriod).toMatchObject({
            startInclusive: "2026-03-02T05:00:00.000Z",
            endExclusive: "2026-03-09T04:00:00.000Z",
            kind: "completed-week",
        });
    });
    it("retries a lost decision response with the same key and creates only one action", async () => {
        sim = new ContractSimulator("lost-response");
        const input = {
            decision: "  Test the label  ",
            commitment: {
                title: "Test navigation",
                owner: "Founder",
                dueOn: "2026-10-24",
                test: "Four of five finish",
                shared: false,
            },
        };
        await expect(vantageApi.decide("topic-demo-1", input)).rejects.toThrow("lost response");
        const result = await vantageApi.decide("topic-demo-1", input);
        const submissions = sim.requests.filter(r => r.path.endsWith("/decide"));
        expect(submissions).toHaveLength(2);
        expect(submissions[0]!.key).toBeTruthy();
        expect(submissions[1]!.key).toBe(submissions[0]!.key);
        expect(sim.commitments).toHaveLength(1);
        expect(result.topic.commitmentId).toBe(sim.commitments[0]!.id);
        const action = sim.commitments[0]!;
        await vantageApi.patchCommitment(action.id, { status: "done", outcome: "Four finished" });
        const replay = await sim.respond(
            new URL("http://localhost/api/vantage/topics/topic-demo-1/decide"),
            {
                method: "POST",
                headers: { "Idempotency-Key": submissions[0]!.key! },
                body: JSON.stringify({ ...input, decision: "Test the label" }),
            }
        );
        expect(replay?.status).toBe(200);
        expect(sim.commitments[0]).toMatchObject({
            id: action.id,
            status: "done",
            outcome: "Four finished",
        });
    });
    it("keeps the original topic when accepting an enhancement and sends its base version", async () => {
        const before = (await vantageApi.agendas()).agenda!;
        const topic = before.topics[0]!;
        const result = await vantageApi.reviewEnhancement(
            topic.id,
            before.enhancements[0]!.id,
            "accepted",
            topic.contentVersion
        );
        expect(result.enhancement.status).toBe("accepted");
        expect((await vantageApi.agendas()).agenda!.topics[0]).toEqual(topic);
    });
    it("returns stale enhancement errors without changing the saved suggestion", async () => {
        await vantageApi.patchTopic("topic-demo-1", { title: "Human wording" });
        await expect(
            vantageApi.reviewEnhancement("topic-demo-1", "enhancement-demo-1", "accepted", 2)
        ).rejects.toMatchObject({ status: 409, code: "stale_topic" });
        expect((await vantageApi.agendas()).agenda!.enhancements[0]!.status).toBe("suggested");
    });
    it("preserves saved human text across regeneration", async () => {
        await vantageApi.patchTopic("topic-demo-1", { title: "A founder's wording" });
        const result = await vantageApi.prepare("2026-10-12");
        expect(result.agenda.topics[0]).toMatchObject({
            id: "topic-demo-1",
            title: "A founder's wording",
            contentVersion: 3,
        });
        expect(result.agenda.enhancements.some(e => e.baseTopicVersion === 3)).toBe(true);
    });
    it("does not replace the prior report when generation is unavailable", async () => {
        sim = new ContractSimulator("unavailable");
        const before = await vantageApi.agendas();
        await expect(vantageApi.prepare()).rejects.toMatchObject({
            status: 503,
            code: "generation_unavailable",
        });
        expect(await vantageApi.agendas()).toEqual(before);
    });
});
