jest.mock("@launchstack/store/client", () => ({ getDb: jest.fn() }));
import { PgDialect } from "drizzle-orm/pg-core";
import { getDb } from "@launchstack/store/client";
import {
    authorizeLegacyAgendaRead,
    authorizeLegacyCommitmentRead,
    authorizeLegacyCommitmentSource,
    authorizeLegacyEvidenceMutation,
    authorizeLegacyOverviewRead,
    type LegacyReadStore,
} from "~/server/vantage/legacy-read-authority";
import { listEvidence, type AgendaDto, type CommitmentDto } from "@launchstack/pipelines/vantage";
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
    agenda: jest.fn(async () => agenda()),
    topicAgendaId: jest.fn(async () => "a"),
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

describe("retained manual evidence authority", () => {
    it("applies workspace, creator/sharing and source predicates before the page limit", async () => {
        const query = {
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            limit: jest.fn().mockResolvedValue([
                { id: "owned", createdByUserId: "u", createdAt: new Date(0) },
                { id: "shared", createdByUserId: "other", createdAt: new Date(0) },
            ]),
        };
        jest.mocked(getDb).mockReturnValue({ select: () => query } as never);
        const evidence = await listEvidence({
            companyId: 1n,
            viewer: { userId: "u", canEdit: true },
            limit: 2,
        });
        const { sql, params } = new PgDialect().sqlToQuery(query.where.mock.calls[0]![0]);
        expect(sql).toMatch(
            /"company_id" = \$1 and .*"kind" <> \$2 and \(.*"created_by_user_id" = \$3 or .*"visibility" = \$4\)/
        );
        expect(params.map(String)).toEqual(["1", "document", "u", "shared"]);
        expect(query.limit).toHaveBeenCalledWith(2);
        expect(query.where.mock.invocationCallOrder[0]).toBeLessThan(
            query.limit.mock.invocationCallOrder[0]!
        );
        expect(evidence.map(({ id, canEdit }) => ({ id, canEdit }))).toEqual([
            { id: "owned", canEdit: true },
            { id: "shared", canEdit: false },
        ]);
    });
    it.each([
        ["other", "note"],
        ["u", "document"],
    ])("rejects mutation of %s / %s", async (createdByUserId, kind) => {
        const s = store();
        s.records = async () => [{ id: "e", createdByUserId, kind, visibility: "shared" }];
        await expect(authorizeLegacyEvidenceMutation(ctx, "e", s)).rejects.toMatchObject({
            status: 403,
        });
    });
    it("allows creator mutation and requires edit capability", async () => {
        await expect(authorizeLegacyEvidenceMutation(ctx, "e", store())).resolves.toBeUndefined();
        await expect(
            authorizeLegacyEvidenceMutation(
                { ...ctx, can: p => p === "documents.read" },
                "e",
                store()
            )
        ).rejects.toMatchObject({ status: 403 });
    });
});

describe("linked legacy commitment authority", () => {
    it("resolves topic-only historical links to their authorized agenda", async () => {
        const s = store();
        await expect(
            authorizeLegacyCommitmentSource(ctx, { agendaId: null, topicId: "topic" }, s)
        ).resolves.toBeUndefined();
        expect(s.topicAgendaId).toHaveBeenCalledWith(1n, "topic");
        expect(s.agenda).toHaveBeenCalledWith(1n, "a");
    });

    it("rejects a mismatched topic and agenda link", async () => {
        const s = store();
        await expect(
            authorizeLegacyCommitmentSource(ctx, { agendaId: "different", topicId: "topic" }, s)
        ).rejects.toMatchObject({ status: 403 });
        expect(s.agenda).not.toHaveBeenCalled();
    });

    it("does not expose a linked title after the source is denied", async () => {
        const s = store();
        s.records = async (_companyId, kind) =>
            kind === "cm"
                ? [{ id: "c", createdByUserId: "u", agendaId: "a", topicId: "topic" }]
                : [];
        await expect(
            authorizeLegacyCommitmentRead(
                ctx,
                [
                    {
                        id: "c",
                        agendaId: "a",
                        topicId: "topic",
                        topicTitle: "Private",
                    } as CommitmentDto,
                ],
                s
            )
        ).rejects.toMatchObject({ status: 403 });
    });
});
