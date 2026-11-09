jest.mock("@launchstack/store/client", () => ({ getDb: jest.fn() }));
import {
    authorizeLegacyAgendaRead,
    authorizeLegacyOverviewRead,
    type LegacyReadStore,
} from "~/server/vantage/legacy-read-authority";
import type { AgendaDto } from "@launchstack/pipelines/vantage";
import type { VantageCtx } from "~/app/api/vantage/_http";
import type { OverviewDto } from "~/server/vantage/service";
const ctx: VantageCtx = { companyId: 1n, userId: "u", can: () => true };
const agenda = (): AgendaDto =>
    ({
        id: "a",
        signals: null,
        topics: [{ facts: [{ text: "Private note", refs: [{ ref: "ev:e" }] }], conflicts: [] }],
    }) as unknown as AgendaDto;
const store = (): LegacyReadStore => ({
    agendaOwner: jest.fn(async companyId => (companyId === 1n ? "u" : null)),
    records: jest.fn(async () => [{ id: "e", createdByUserId: "u", kind: "note" }]),
});
describe("legacy native private report authority", () => {
    it("allows creator-owned manual historical V1 without changing its data", async () => {
        const a = agenda(),
            snapshot = JSON.stringify(a);
        await expect(authorizeLegacyAgendaRead(ctx, a, store())).resolves.toBeUndefined();
        expect(JSON.stringify(a)).toBe(snapshot);
    });
    it("denies other-company actor", async () => {
        await expect(
            authorizeLegacyAgendaRead({ ...ctx, companyId: 2n }, agenda(), store())
        ).rejects.toMatchObject({ status: 403 });
    });
    it("denies same-company other reader", async () => {
        await expect(
            authorizeLegacyAgendaRead({ ...ctx, userId: "other" }, agenda(), store())
        ).rejects.toMatchObject({ status: 403 });
    });
    it("requires current read capability even for the creator", async () => {
        await expect(
            authorizeLegacyAgendaRead({ ...ctx, can: () => false }, agenda(), store())
        ).rejects.toMatchObject({ status: 403 });
    });
    it("withholds unresolved document-derived evidence even from creator", async () => {
        const s = store();
        s.records = async () => [{ id: "e", createdByUserId: "u", kind: "document" }];
        await expect(authorizeLegacyAgendaRead(ctx, agenda(), s)).rejects.toMatchObject({
            status: 403,
        });
    });
    it("withholds a missing cited dependency", async () => {
        const s = store();
        s.records = async () => [];
        await expect(authorizeLegacyAgendaRead(ctx, agenda(), s)).rejects.toMatchObject({
            status: 403,
        });
    });
    it("withholds another person's private evidence used by creator's report", async () => {
        const s = store();
        s.records = async () => [{ id: "e", createdByUserId: "other", kind: "note" }];
        await expect(authorizeLegacyAgendaRead(ctx, agenda(), s)).rejects.toMatchObject({
            status: 403,
        });
    });
    it("does not invent lineage from an unregistered document reference", async () => {
        const a = agenda();
        a.topics[0]!.facts[0]!.refs = [{ ref: "doc:12@v1", label: "Document", date: null }];
        await expect(authorizeLegacyAgendaRead(ctx, a, store())).rejects.toMatchObject({
            status: 403,
        });
    });
    it("overview cannot leak recent private note bodies without an agenda", async () => {
        const s = store();
        s.records = async () => [{ id: "e", createdByUserId: "other", kind: "note" }];
        const value = {
            agenda: null,
            previousAgenda: null,
            signals: {
                newEvidence: [],
                recentEvidenceIds: [],
                metricChanges: [],
                metricConflicts: [],
                overdueCommitmentIds: [],
                dueThisWeekCommitmentIds: [],
                resolvedCommitmentIds: [],
            },
            recentEvidence: [{ id: "e", body: "private" }],
            checkIns: [],
        } as unknown as OverviewDto;
        await expect(authorizeLegacyOverviewRead(ctx, value, s)).rejects.toMatchObject({
            status: 403,
        });
    });
});
