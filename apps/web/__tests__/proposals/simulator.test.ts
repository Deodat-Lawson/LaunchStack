/**
 * The preview harness's `/api/proposals/*` is the contract the screens are
 * built against: runs that finish and change the world, sections that keep
 * their status rules, a checklist that ticks its section rows itself.
 */
import type {
    ApplicationDetail,
    ApplicationRow,
    FunderRow,
    HomeDto,
    LibraryItemDto,
    RunDto,
    SectionDto,
} from "~/app/employer/tools/proposals/api";
import {
    resetProposalsSim,
    setProposalsSimClock,
    simulateProposals,
} from "~/app/dev/proposals/simulator";

let now = Date.now();

async function call<T>(url: string, init?: RequestInit): Promise<{ status: number; body: T }> {
    const response = await simulateProposals(new URL(url, "http://proposals.local"), init, now);
    if (!response) throw new Error(`not simulated: ${url}`);
    return { status: response.status, body: (await response.json()) as T };
}
const post = (body?: unknown) => ({
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
});
const patch = (body: unknown) => ({ method: "PATCH", body: JSON.stringify(body) });

beforeEach(() => {
    now = Date.now();
    setProposalsSimClock(() => now);
    resetProposalsSim();
});

describe("world", () => {
    it("opens on a built profile, three applications and a library", async () => {
        const home = (await call<HomeDto>("/api/proposals/home")).body;
        expect(home.profile.status).toBe("ready");
        expect(home.deadlines.map(a => a.id)).toEqual(["app-meyer", "app-ed"]);
        expect(home.funders.strong).toBeGreaterThanOrEqual(2);
        expect(home.library).toBe(3);
        expect(home.todo[0]!.id).toBe("funders");
    });

    it("keeps readiness in step with sections and the checklist", async () => {
        const app = (
            await call<{ application: ApplicationDetail }>("/api/proposals/applications/app-meyer")
        ).body.application;
        expect(app.sections).toEqual({ total: 5, written: 2, approved: 1 });
        expect(app.requirements.find(r => r.sectionKey === "statement-of-need")!.done).toBe(true);
        expect(app.readiness).toBeGreaterThan(0);
        expect(app.readiness).toBeLessThan(100);
    });
});

describe("runs", () => {
    it("finds funders over a few seconds and adds them when done", async () => {
        const before = (await call<{ funders: FunderRow[] }>("/api/proposals/funders")).body.funders
            .length;
        const { status, body } = await call<{ run: RunDto }>(
            "/api/proposals/funders/search",
            post({})
        );
        expect(status).toBe(202);
        expect(body.run.status).toBe("running");
        now += 2000;
        const mid = (await call<{ run: RunDto }>(`/api/proposals/runs/${body.run.id}`)).body.run;
        expect(mid.steps[0]!.status).toBe("done");
        expect(mid.steps[1]!.status).toBe("running");
        now += 8000;
        const done = (await call<{ run: RunDto }>(`/api/proposals/runs/${body.run.id}`)).body.run;
        expect(done.status).toBe("completed");
        expect(done.headline).toMatch(/funders found/);
        const after = (await call<{ funders: FunderRow[] }>("/api/proposals/funders")).body.funders
            .length;
        expect(after).toBe(before + 3);
    });

    it("reads a new application's request into sections, then drafts and reviews it", async () => {
        const created = await call<{ application: ApplicationDetail; run: RunDto | null }>(
            "/api/proposals/applications",
            post({ title: "Test call", requestText: "x".repeat(100) })
        );
        expect(created.status).toBe(201);
        expect(created.body.run?.kind).toBe("extract");
        const id = created.body.application.id;
        now += 5000;
        await call(`/api/proposals/runs/${created.body.run!.id}`);
        let app = (
            await call<{ application: ApplicationDetail }>(`/api/proposals/applications/${id}`)
        ).body.application;
        expect(app.sectionList).toHaveLength(4);
        expect(app.requirements.filter(r => r.kind === "section")).toHaveLength(4);

        const draft = (
            await call<{ run: RunDto }>(`/api/proposals/applications/${id}/draft`, post({}))
        ).body.run;
        expect(draft.steps).toHaveLength(4);
        now += 11_000;
        await call(`/api/proposals/runs/${draft.id}`);
        app = (await call<{ application: ApplicationDetail }>(`/api/proposals/applications/${id}`))
            .body.application;
        expect(app.sectionList.every(s => s.status === "drafted" && s.cites.length > 0)).toBe(true);
        expect(app.status).toBe("in_progress");

        const again = await call<{ error: string }>(
            `/api/proposals/applications/${id}/draft`,
            post({})
        );
        expect(again.status).toBe(409);

        const review = (
            await call<{ run: RunDto }>(`/api/proposals/applications/${id}/review`, post())
        ).body.run;
        now += 6000;
        await call(`/api/proposals/runs/${review.id}`);
        app = (await call<{ application: ApplicationDetail }>(`/api/proposals/applications/${id}`))
            .body.application;
        expect(app.review).not.toBeNull();
        expect(app.status).toBe("in_review");
        expect(app.review!.findings.some(f => f.kind === "eligibility")).toBe(true);
    });
});

describe("editing", () => {
    it("typing makes a section edited, clearing empties it, approving needs text", async () => {
        const url = "/api/proposals/applications/app-meyer/sections/s-outcomes";
        const empty = await call<{ error: string }>(url, patch({ status: "approved" }));
        expect(empty.status).toBe(409);
        const typed = (
            await call<{ section: SectionDto }>(url, patch({ draft: "We measure with DIBELS." }))
        ).body.section;
        expect(typed.status).toBe("edited");
        expect(typed.words).toBe(4);
        const approved = (await call<{ section: SectionDto }>(url, patch({ status: "approved" })))
            .body.section;
        expect(approved.status).toBe("approved");
        const app = (
            await call<{ application: ApplicationDetail }>("/api/proposals/applications/app-meyer")
        ).body.application;
        expect(app.requirements.find(r => r.sectionKey === "outcomes-and-evaluation")!.done).toBe(
            true
        );
        const cleared = (await call<{ section: SectionDto }>(url, patch({ draft: "" }))).body
            .section;
        expect(cleared.status).toBe("empty");
    });

    it("rewrites a drafted section as a run and refuses an empty one", async () => {
        const empty = await call<{ error: string }>(
            "/api/proposals/applications/app-meyer/sections/s-outcomes/rewrite",
            post({ preset: "tighten" })
        );
        expect(empty.status).toBe(409);
        const { status, body } = await call<{ run: RunDto }>(
            "/api/proposals/applications/app-meyer/sections/s-approach/rewrite",
            post({ preset: "tighten" })
        );
        expect(status).toBe(202);
        expect(body.run.kind).toBe("rewrite");
        now += 4000;
        const done = (await call<{ run: RunDto }>(`/api/proposals/runs/${body.run.id}`)).body.run;
        expect(done.status).toBe("completed");
        expect(done.headline).toMatch(/Rewritten/);
        const app = (
            await call<{ application: ApplicationDetail }>("/api/proposals/applications/app-meyer")
        ).body.application;
        const s = app.sectionList.find(x => x.id === "s-approach")!;
        expect(s.words).toBeLessThanOrEqual(500);
        expect(s.status).toBe("drafted");
        const md = (
            await call<{ markdown: string }>("/api/proposals/applications/app-meyer/markdown")
        ).body;
        expect(md.markdown).toContain("# Meyer Memorial Trust");
    });

    it("ticks checklist rows by hand but never section rows", async () => {
        const url = "/api/proposals/applications/app-meyer";
        const ticked = (
            await call<{ application: ApplicationDetail }>(
                url,
                patch({ requirement: { id: "eligibility:budget", done: true } })
            )
        ).body.application;
        expect(ticked.requirements.find(r => r.id === "eligibility:budget")!.done).toBe(true);
        const forced = (
            await call<{ application: ApplicationDetail }>(
                url,
                patch({ requirement: { id: "section:budget-narrative", done: true } })
            )
        ).body.application;
        expect(forced.requirements.find(r => r.id === "section:budget-narrative")!.done).toBe(
            false
        );
    });

    it("saves an approved answer to the library with its cited evidence", async () => {
        const { status, body } = await call<{ item: LibraryItemDto }>(
            "/api/proposals/applications/app-meyer/sections/s-need/library",
            post({ tags: ["need"] })
        );
        expect(status).toBe(201);
        expect(body.item.evidence.map(e => e.n)).toEqual([1, 2]);
        expect(body.item.sourceApplicationTitle).toContain("Meyer");
        const items = (await call<{ items: LibraryItemDto[] }>("/api/proposals/library")).body
            .items;
        expect(items).toHaveLength(4);
    });

    it("applying from a funder links the application and marks the funder", async () => {
        const created = (
            await call<{ application: ApplicationDetail; run: RunDto | null }>(
                "/api/proposals/applications",
                post({ title: "", opportunityId: "f-oct" })
            )
        ).body;
        expect(created.application.funder).toBe("Oregon Community Foundation");
        expect(created.application.opportunityId).toBe("f-oct");
        const funders = (await call<{ funders: FunderRow[] }>("/api/proposals/funders")).body
            .funders;
        const f = funders.find(x => x.id === "f-oct")!;
        expect(f.status).toBe("applied");
        expect(f.applicationId).toBe(created.application.id);
        const rows = (await call<{ applications: ApplicationRow[] }>("/api/proposals/applications"))
            .body.applications;
        expect(rows[0]!.id).toBe(created.application.id);
    });
});
