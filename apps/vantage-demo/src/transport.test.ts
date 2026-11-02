import { describe, it, expect, vi } from "vitest";
import { createPortableTransport, installPortableTransport } from "./transport";
const patch = (body: unknown) => ({ method: "PATCH", body: JSON.stringify(body) });
describe("portable recorded transport", () => {
    it("never delegates unknown requests or unsupported mutations", async () => {
        const original = vi.fn();
        const target = { fetch: original as typeof fetch };
        const t = installPortableTransport(target);
        for (const url of [
            "https://example.com/api/vantage/demo",
            "/api/unknown",
            "/api/vantage/unregistered",
        ]) {
            expect((await target.fetch(url)).ok).toBe(false);
        }
        expect(
            (await target.fetch("/api/vantage/commitments", { method: "POST", body: "{}" })).status
        ).toBe(405);
        expect(original).not.toHaveBeenCalled();
        t.restore();
        expect(target.fetch).toBe(original);
    });
    it("returns isolated recorded replay and exact source versions", async () => {
        const t = createPortableTransport();
        const s = await (await t.fetch("/api/vantage/demo")).json();
        expect(s.generationMode).toBe("replay");
        expect(s.report.execution.mode).toBe("replay");
        const source = t.getSnapshot().sources[0]!;
        const params = new URLSearchParams({
            reportId: s.report.id,
            kind: source.source.kind,
            id: source.source.id,
            version: source.source.version,
        });
        const found = await (await t.fetch(`/api/vantage/demo/source?${params}`)).json();
        expect(found.body).toBe(source.body);
        params.set("version", "wrong");
        expect((await t.fetch(`/api/vantage/demo/source?${params}`)).status).toBe(404);
        const snap = t.getSnapshot();
        snap.state.report!.summary = "tampered";
        expect(t.getSnapshot().state.report!.summary).not.toBe("tampered");
    });
    it("labels every source authority as recorded without changing evidence", async () => {
        const t = createPortableTransport();
        const snapshot = t.getSnapshot();
        for (const source of snapshot.sources) {
            const params = new URLSearchParams({
                reportId: snapshot.state.report!.id,
                kind: source.source.kind,
                id: source.source.id,
                version: source.source.version,
            });
            const found = await (await t.fetch(`/api/vantage/demo/source?${params}`)).json();
            expect(found.authority).toContain("Recorded synthetic snapshot from");
            expect(found.authority).toContain("no live version or access check");
            expect(found.body).toBe(source.body);
            expect(found.source).toEqual(source.source);
        }
        if (snapshot.state.companyArchitecture)
            expect(snapshot.state.companyArchitecture.authority).toContain(
                "Recorded synthetic snapshot"
            );
    });
    it("CAS review edits stay in memory and do not create actions", async () => {
        const t = createPortableTransport();
        const r = t.getSnapshot().state.report!;
        const change = {
            reportId: r.id,
            topicId: r.topics[0]!.id,
            expectedVersion: r.version,
            status: "kept",
            decision: { value: "needs-more-evidence", text: "Local test choice" },
        };
        expect((await t.fetch("/api/vantage/demo/topics", patch(change))).ok).toBe(true);
        expect(t.getSnapshot().state.report!.version).toBe(r.version + 1);
        expect(t.getSnapshot().state.report!.topics[0]!.decision?.value).toBe(
            "needs-more-evidence"
        );
        expect((await t.fetch("/api/vantage/demo/topics", patch(change))).status).toBe(409);
        expect(t.getSnapshot().commitments).toEqual([]);
        t.reset();
        expect(t.getSnapshot().state.report!.version).toBe(r.version);
    });
    it("roles and stars use revision CAS and retain unreviewed profile blocker", async () => {
        const t = createPortableTransport();
        const before = t.getSnapshot().personal;
        const body = {
            operation: "roles",
            roleIds: ["founder"],
            primaryRoleId: "founder",
            expectedRevision: before.state.revision,
        };
        expect((await t.fetch("/api/vantage/demo/personal", patch(body))).ok).toBe(true);
        expect((await t.fetch("/api/vantage/demo/personal", patch(body))).status).toBe(409);
        const p = t.getSnapshot().personal;
        expect(p.ready).toBe(false);
        expect(p.roles.userConfirmed).toBe(true);
        const star = {
            operation: "star",
            documentId: p.documents[0]!.id,
            starred: true,
            expectedRevision: p.state.revision,
        };
        expect((await t.fetch("/api/vantage/demo/personal", patch(star))).ok).toBe(true);
        expect(t.getSnapshot().personal.state.stars).toHaveLength(1);
        expect(
            (
                await t.fetch(
                    "/api/vantage/demo/personal",
                    patch({
                        ...star,
                        expectedRevision: p.state.revision + 1,
                        documentId: "unknown",
                    })
                )
            ).status
        ).toBe(400);
    });
    it("pending questions require explicit review and version", async () => {
        const t = createPortableTransport();
        const p = t.getSnapshot().pending;
        const path = `/api/vantage/agendas/${p.agendaId}/pending-questions`;
        const change = {
            questionId: p.questions[0]!.questionId,
            status: "addressed",
            expectedVersion: p.version,
        };
        expect((await t.fetch(path, patch(change))).ok).toBe(true);
        expect(t.getSnapshot().pending.questions).toHaveLength(0);
        expect((await t.fetch(path, patch(change))).status).toBe(409);
        t.reset();
        expect(t.getSnapshot().pending.questions).toHaveLength(1);
    });
    it("replay reloads only recorded report and never pretends another week was generated", async () => {
        const t = createPortableTransport();
        expect(
            (
                await t.fetch("/api/vantage/demo", {
                    method: "POST",
                    body: JSON.stringify({ weekStart: "2099-01-01" }),
                })
            ).status
        ).toBe(404);
        const week = t.getSnapshot().state.report!.weekStart;
        expect(
            (
                await t.fetch("/api/vantage/demo", {
                    method: "POST",
                    body: JSON.stringify({ weekStart: week }),
                })
            ).ok
        ).toBe(true);
        const unavailable = await t.fetch("/api/vantage/demo?week=2099-01-01");
        expect(unavailable.status).toBe(404);
        expect((await unavailable.json()).error).toContain("only the recorded week");
        expect(t.getSnapshot().state.weeks.map(item => item.weekStart)).toEqual([week]);
    });
    it("serves all auxiliary screens without fabricating metrics or actions", async () => {
        const t = createPortableTransport();
        for (const path of [
            "overview",
            "triage",
            "agendas",
            "evidence",
            "metrics",
            "commitments",
            "deadlines",
        ]) {
            expect((await t.fetch(`/api/vantage/${path}`)).ok).toBe(true);
        }
        expect(await (await t.fetch("/api/vantage/metrics")).json()).toEqual({
            definitions: [],
            observations: [],
        });
    });
});
