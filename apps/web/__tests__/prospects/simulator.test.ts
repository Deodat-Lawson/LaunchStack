/**
 * The Prospects simulator is the only implementation of `/api/prospects/*`
 * today, and the UI's behaviour rests on its rules: legal stage moves with
 * reasons, outreach refusals, exclusions, and a run that adds companies when
 * it completes. These tests pin those rules so the real routes can be built
 * to the same contract.
 */
import type {
    CompanyDetail,
    CompanyRow,
    HomeDto,
    OutreachResult,
    PersonRow,
    RunDto,
    SegmentSummary,
    SourceRow,
} from "~/app/employer/tools/prospects/api";
import {
    _debugState,
    resetSimulator,
    setSimulatorClock,
    simulate,
} from "~/app/dev/prospects/simulator";

let now = Date.now();

async function call<T>(url: string, init?: RequestInit): Promise<{ status: number; body: T }> {
    const response = await simulate(url, {
        ...init,
        headers: { "Content-Type": "application/json" },
    });
    if (!response) throw new Error(`not simulated: ${url}`);
    return { status: response.status, body: (await response.json()) as T };
}

beforeEach(() => {
    now = Date.now();
    setSimulatorClock(() => now);
    resetSimulator();
});

describe("segments and companies", () => {
    it("lists two segments with live counts", async () => {
        const { body } = await call<{ segments: SegmentSummary[] }>("/api/prospects/segments");
        expect(body.segments.map(s => s.id)).toEqual(["seg-fulfilment", "seg-grocery"]);
        const main = body.segments[0]!;
        expect(main.status).toBe("confirmed");
        expect(main.counts.companies).toBeGreaterThan(10);
        expect(main.counts.sources).toBe(6);
        expect(body.segments[1]!.counts.companies).toBe(0);
    });

    it("view counts partition the segment and search narrows it", async () => {
        const all = await call<{ companies: CompanyRow[]; counts: Record<string, number> }>(
            "/api/prospects/companies?segmentId=seg-fulfilment"
        );
        expect(all.body.companies.every(c => !c.excluded)).toBe(true);
        expect(all.body.counts.all).toBe(all.body.companies.length);
        expect(all.body.counts.excluded).toBe(2);
        expect(all.body.counts.new).toBe(3);
        expect(all.body.companies[0]!.fit).toBe(90);

        const q = await call<{ companies: CompanyRow[] }>(
            "/api/prospects/companies?segmentId=seg-fulfilment&q=hamburg"
        );
        expect(q.body.companies.map(c => c.name)).toEqual(["Nordlager Fulfilment GmbH"]);
    });

    it("returns 404 for unknown and reserve companies", async () => {
        expect((await call("/api/prospects/companies/nope")).status).toBe(404);
        expect((await call("/api/prospects/companies/co-orchard")).status).toBe(404);
    });
});

describe("deals", () => {
    it("refuses Contacted without an owner and allows it after Take it", async () => {
        const before = await call<{ company: CompanyDetail }>(
            "/api/prospects/companies/co-nordlager"
        );
        const contacted = before.body.company.deal.allowedMoves.find(m => m.stage === "contacted");
        expect(contacted?.reason).toBe("Needs an owner");

        const refused = await call<{ error: string; reason: string }>(
            "/api/prospects/deals/deal-co-nordlager",
            { method: "PATCH", body: JSON.stringify({ stage: "contacted" }) }
        );
        expect(refused.status).toBe(409);
        expect(refused.body.reason).toBe("Needs an owner");

        const owned = await call<{ deal: { stage: string; ownerName: string } }>(
            "/api/prospects/deals/deal-co-nordlager",
            { method: "PATCH", body: JSON.stringify({ ownerName: "You", stage: "contacted" }) }
        );
        expect(owned.status).toBe(200);
        expect(owned.body.deal.stage).toBe("contacted");
        expect(owned.body.deal.ownerName).toBe("You");
    });

    it("keeps won deals won and needs a proposal before winning", async () => {
        const won = await call<{ company: CompanyDetail }>("/api/prospects/companies/co-lls");
        const back = won.body.company.deal.allowedMoves.find(m => m.stage === "meeting");
        expect(back?.reason).toBe("Won deals stay won");

        const early = await call<{ company: CompanyDetail }>("/api/prospects/companies/co-vandijk");
        expect(early.body.company.deal.allowedMoves.find(m => m.stage === "won")?.reason).toBe(
            "Needs a proposal first"
        );
    });

    it("marks a contacted deal stale after seven quiet days", async () => {
        const hanse = await call<{ company: CompanyDetail }>("/api/prospects/companies/co-hanse");
        expect(hanse.body.company.deal.staleDays).toBeGreaterThan(7);
        const home = await call<HomeDto>("/api/prospects/home?segmentId=seg-fulfilment");
        expect(home.body.todo.some(t => t.id === "stale")).toBe(true);
        expect(home.body.todo.some(t => t.id === "review-new")).toBe(true);
    });
});

describe("outreach and exclusions", () => {
    it("drafts a campaign for verified and found people and skips the rest with reasons", async () => {
        const people = await call<{ people: PersonRow[] }>(
            "/api/prospects/people?segmentId=seg-fulfilment"
        );
        const delta = people.body.people.filter(p => p.companyId === "co-delta");
        const result = await call<OutreachResult>("/api/prospects/outreach", {
            method: "POST",
            body: JSON.stringify({ personIds: delta.map(p => p.id) }),
        });
        expect(result.status).toBe(201);
        expect(result.body.people).toBe(3);
        expect(result.body.skipped).toEqual([{ personId: "p-delta-4", reason: "Shared inbox" }]);
    });

    it("refuses outreach to an excluded company's people", async () => {
        const result = await call<{ error: string; skipped: Array<{ reason: string }> }>(
            "/api/prospects/outreach",
            { method: "POST", body: JSON.stringify({ personIds: ["p-glo-1"] }) }
        );
        expect(result.status).toBe(409);
        expect(result.body.skipped[0]!.reason).toMatch(/excluded/);
    });

    it("exclusion removes a company from every view except Excluded", async () => {
        await call("/api/prospects/companies/exclude", {
            method: "POST",
            body: JSON.stringify({ ids: ["co-delta"], excluded: true }),
        });
        const list = await call<{ companies: CompanyRow[]; counts: Record<string, number> }>(
            "/api/prospects/companies?segmentId=seg-fulfilment&view=excluded"
        );
        expect(list.body.companies.some(c => c.id === "co-delta")).toBe(true);
        expect(list.body.counts.excluded).toBe(3);
    });
});

describe("runs", () => {
    it("progresses with the clock and adds the reserve when it completes", async () => {
        const start = _debugState();
        const started = await call<{ run: RunDto }>("/api/prospects/runs", {
            method: "POST",
            body: JSON.stringify({ segmentId: "seg-fulfilment" }),
        });
        expect(started.status).toBe(201);
        const id = started.body.run.id;

        now += 2000;
        const early = await call<{ run: RunDto }>(`/api/prospects/runs/${id}`);
        const sources = early.body.run.steps.find(s => s.id === "sources")!;
        expect(early.body.run.status).toBe("running");
        expect(sources.children!.find(c => c.id === "recipe:linkedin-company")!.status).toBe(
            "done"
        );
        expect(sources.children!.find(c => c.id === "serper-maps")!.status).toBe("running");
        expect(sources.children!.find(c => c.id === "osm-overpass")!.status).toBe("skipped");
        expect(sources.children!.find(c => c.id === "recipe:glassdoor")!.detail).toBe(
            "no SERPER_API_KEY"
        );

        const again = await call<{ error: string }>("/api/prospects/runs", {
            method: "POST",
            body: JSON.stringify({ segmentId: "seg-fulfilment" }),
        });
        expect(again.status).toBe(409);

        now += 20_000;
        const done = await call<{ run: RunDto }>(`/api/prospects/runs/${id}`);
        expect(done.body.run.status).toBe("completed");
        expect(done.body.run.summary?.newCompanies).toBe(5);
        const after = _debugState();
        expect(after.companies).toBe(start.companies + 5);
        expect(after.reserve).toBe(0);
        expect(after.pastRuns).toBe(start.pastRuns + 1);

        const fresh = await call<{ companies: CompanyRow[] }>(
            "/api/prospects/companies?segmentId=seg-fulfilment&view=new"
        );
        expect(fresh.body.companies).toHaveLength(5);
        expect(fresh.body.companies.every(c => c.isNew)).toBe(true);
    });

    it("stop keeps what was found and releases nothing new", async () => {
        const started = await call<{ run: RunDto }>("/api/prospects/runs", {
            method: "POST",
            body: JSON.stringify({ segmentId: "seg-fulfilment" }),
        });
        now += 3500;
        const stopped = await call<{ run: RunDto }>(
            `/api/prospects/runs/${started.body.run.id}/stop`,
            {
                method: "POST",
            }
        );
        expect(stopped.body.run.status).toBe("stopped");
        expect(stopped.body.run.summary?.newCompanies).toBe(0);
        expect(stopped.body.run.summary?.found).toBeGreaterThan(0);
        now += 60_000;
        expect(_debugState().reserve).toBe(5);
    });

    it("refuses to run a draft segment", async () => {
        const result = await call<{ error: string }>("/api/prospects/runs", {
            method: "POST",
            body: JSON.stringify({ segmentId: "seg-grocery" }),
        });
        expect(result.status).toBe(409);
    });
});

describe("sources and segment", () => {
    it("toggling a source changes the rail count and a missing key cannot be switched on", async () => {
        const off = await call<{ source: SourceRow }>(
            "/api/prospects/sources/exa-company?segmentId=seg-fulfilment",
            { method: "PATCH", body: JSON.stringify({ enabled: false }) }
        );
        expect(off.body.source.enabled).toBe(false);
        const segments = await call<{ segments: SegmentSummary[] }>("/api/prospects/segments");
        expect(segments.body.segments[0]!.counts.sources).toBe(5);

        const glassdoor = await call<{ error: string }>(
            "/api/prospects/sources/recipe%3Aglassdoor?segmentId=seg-fulfilment",
            { method: "PATCH", body: JSON.stringify({ enabled: true }) }
        );
        expect(glassdoor.status).toBe(409);
    });

    it("editing a segment field makes it a draft until confirmed", async () => {
        const patched = await call<{
            segment: { status: string; fields: Array<{ key: string; value: unknown }> };
        }>("/api/prospects/segments/seg-fulfilment", {
            method: "PATCH",
            body: JSON.stringify({ fields: { geographies: ["Netherlands"] } }),
        });
        expect(patched.body.segment.status).toBe("draft");
        expect(patched.body.segment.fields.find(f => f.key === "geographies")?.value).toEqual([
            "Netherlands",
        ]);
        const confirmed = await call<{ segment: { status: string } }>(
            "/api/prospects/segments/seg-fulfilment/confirm",
            { method: "POST" }
        );
        expect(confirmed.body.segment.status).toBe("confirmed");
    });
});
