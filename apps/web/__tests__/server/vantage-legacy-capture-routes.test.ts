jest.mock("~/app/api/vantage/_http", () => ({
    vantageContext: jest.fn(),
    error: (message: string, status: number, fields: object) =>
        Response.json({ error: message, ...fields }, { status }),
    say: (_request: Request, key: string) => key,
    json: (body: unknown, status = 200) => Response.json(body, { status }),
    readBody: (request: Request) => request.json(),
    handleVantageError: (_scope: string, err: { status?: number }) =>
        Response.json({}, { status: err.status ?? 500 }),
}));
jest.mock("@launchstack/pipelines/vantage", () => ({
    VANTAGE_EVIDENCE_KINDS: ["note", "document"],
    VANTAGE_VISIBILITIES: ["private", "shared"],
    VANTAGE_COMMITMENT_STATUSES: ["open", "done", "missed", "dropped"],
    VantageError: class VantageError extends Error {
        readonly status: number;
        readonly code: string;
        constructor(message: string, status: number, code: string) {
            super(message);
            this.status = status;
            this.code = code;
        }
    },
    isIsoDate: () => true,
    listEvidence: jest.fn(),
    createEvidence: jest.fn(),
    updateEvidence: jest.fn(),
    deleteEvidence: jest.fn(),
    listMetricDefinitionRows: jest.fn(),
    toDefinitionDto: (row: unknown) => row,
    listObservations: jest.fn(),
    createMetricDefinition: jest.fn(),
    createObservation: jest.fn(),
    createObservations: jest.fn(),
    ensureMetricDefinitions: jest.fn(),
    listCommitments: jest.fn(),
    updateCommitment: jest.fn(),
    deleteCommitment: jest.fn(),
    addDays: () => "2026-11-16",
    toIsoDate: () => "2026-11-23",
    listDeadlines: jest.fn(),
}));
jest.mock("~/server/vantage/legacy-read-authority", () => {
    const actual = jest.requireActual<typeof LegacyAuthority>(
        "~/server/vantage/legacy-read-authority"
    );
    return {
        ...actual,
        authorizeLegacyEvidenceMutation: jest.fn(),
        authorizeLegacyCommitmentMutation: (ctx: VantageCtx, id: string) =>
            actual.authorizeLegacyCommitmentMutation(ctx, id, mockStore),
        filterLegacyCommitmentsRead: (ctx: VantageCtx, items: CommitmentDto[]) =>
            actual.filterLegacyCommitmentsRead(ctx, items, mockStore),
    };
});
jest.mock("@launchstack/store/client", () => ({ getDb: jest.fn() }));
import { NextRequest } from "next/server";
import { authorizeLegacyEvidenceMutation } from "~/server/vantage/legacy-read-authority";
import type * as LegacyAuthority from "~/server/vantage/legacy-read-authority";
import {
    listEvidence,
    createEvidence,
    updateEvidence,
    deleteEvidence,
    listMetricDefinitionRows,
    listObservations,
    createObservation,
    ensureMetricDefinitions,
    listCommitments,
    updateCommitment,
    deleteCommitment,
    listDeadlines,
    type AgendaDto,
    type CommitmentDto,
} from "@launchstack/pipelines/vantage";
import { vantageContext, type VantageCtx } from "~/app/api/vantage/_http";
import * as evidence from "~/app/api/vantage/evidence/route";
import * as evidenceItem from "~/app/api/vantage/evidence/[id]/route";
import * as metrics from "~/app/api/vantage/metrics/route";
import * as metricItem from "~/app/api/vantage/metrics/[id]/route";
import * as observations from "~/app/api/vantage/metrics/observations/route";
import * as observation from "~/app/api/vantage/metrics/observations/[id]/route";
import * as metricImport from "~/app/api/vantage/metrics/import/route";
import * as commitments from "~/app/api/vantage/commitments/route";
import * as commitment from "~/app/api/vantage/commitments/[id]/route";
import * as agendas from "~/app/api/vantage/agendas/route";
import * as deadlines from "~/app/api/vantage/deadlines/route";

const mockStore: jest.Mocked<LegacyAuthority.LegacyReadStore> = {
    agendaOwner: jest.fn(),
    agenda: jest.fn(),
    topicAgendaId: jest.fn(),
    records: jest.fn(),
};
const routes = [
    ["evidence read", evidence.GET, "documents.read"],
    ["evidence create", evidence.POST, "documents.edit"],
    ["evidence edit", evidenceItem.PATCH, "documents.edit"],
    ["evidence delete", evidenceItem.DELETE, "documents.edit"],
    ["metric read", metrics.GET, "documents.read"],
    ["metric create", metrics.POST, "documents.edit"],
    ["metric edit", metricItem.PATCH, "documents.edit"],
    ["metric delete", metricItem.DELETE, "documents.edit"],
    ["observation create", observations.POST, "documents.edit"],
    ["observation delete", observation.DELETE, "documents.edit"],
    ["CSV import", metricImport.POST, "documents.edit"],
    ["commitment read", commitments.GET, "documents.read"],
    ["commitment create", commitments.POST, "documents.edit"],
    ["commitment edit", commitment.PATCH, "documents.edit"],
    ["commitment delete", commitment.DELETE, "documents.edit"],
    ["retired agenda creation", agendas.POST, "documents.edit"],
    ["program deadlines", deadlines.GET, "settings.manage"],
] as const;
it.each(routes)(
    "%s requires its capability before parsing or store access",
    async (_name, handler, permission) => {
        const can = jest.fn(() => false);
        jest.mocked(vantageContext).mockResolvedValue({
            ok: true,
            ctx: { companyId: 7n, userId: "viewer", can },
        });
        const response = await handler(new Request("http://localhost/capture") as never, {
            params: Promise.resolve({ id: "other-record" }),
        });
        expect(response.status).toBe(403);
        expect(can).toHaveBeenCalledWith(permission);
    }
);
it.each(routes)("%s preserves Beta denial", async (_name, handler) => {
    jest.mocked(vantageContext).mockResolvedValue({
        ok: false,
        response: Response.json({}, { status: 404 }) as never,
    });
    expect(
        (
            await handler(new Request("http://localhost/capture") as never, {
                params: Promise.resolve({ id: "id" }),
            })
        ).status
    ).toBe(404);
});

describe("retained capture policy", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(vantageContext).mockResolvedValue({
            ok: true,
            ctx: { companyId: 7n, userId: "u", can: () => true },
        });
    });
    it("supplies viewer identity before the evidence query is limited", async () => {
        jest.mocked(listEvidence).mockResolvedValue([{ id: "shared", canEdit: false }] as never);
        const response = await evidence.GET(new NextRequest("http://localhost/evidence"));
        expect(await response.json()).toEqual({ evidence: [{ id: "shared", canEdit: false }] });
        expect(listEvidence).toHaveBeenCalledWith(
            expect.objectContaining({ companyId: 7n, viewer: { userId: "u", canEdit: true } })
        );
    });
    it("cannot create a document capture with unregistered source authority", async () => {
        const response = await evidence.POST(
            new NextRequest("http://localhost/evidence", {
                method: "POST",
                body: JSON.stringify({
                    kind: "document",
                    title: "Document",
                    body: "Source-less",
                    observedAt: "2026-11-23",
                }),
            })
        );
        expect(response.status).toBe(403);
        expect(createEvidence).not.toHaveBeenCalled();
    });
    it.each([evidenceItem.PATCH, evidenceItem.DELETE])(
        "denied evidence owner/source never reaches a writer",
        async handler => {
            jest.mocked(authorizeLegacyEvidenceMutation).mockRejectedValueOnce(
                Object.assign(new Error("denied"), { status: 403 })
            );
            const response = await handler(new NextRequest("http://localhost/evidence/foreign"), {
                params: Promise.resolve({ id: "foreign" }),
            });
            expect(response.status).toBe(403);
            expect(updateEvidence).not.toHaveBeenCalled();
            expect(deleteEvidence).not.toHaveBeenCalled();
        }
    );
    it("keeps metric definitions and observations company shared without a write on read", async () => {
        jest.mocked(listMetricDefinitionRows).mockResolvedValue([
            { id: "company-definition" },
        ] as never);
        jest.mocked(listObservations).mockResolvedValue([{ id: "colleague-observation" }] as never);
        const response = await metrics.GET(new Request("http://localhost/metrics"));
        expect(await response.json()).toEqual({
            definitions: [{ id: "company-definition" }],
            observations: [{ id: "colleague-observation" }],
        });
        expect(listMetricDefinitionRows).toHaveBeenCalledWith(7n);
        expect(listObservations).toHaveBeenCalledWith({ companyId: 7n });
        expect(ensureMetricDefinitions).not.toHaveBeenCalled();
    });

    it("lets an edit-only actor receive only the new observation and never reads another observation", async () => {
        jest.mocked(vantageContext).mockResolvedValue({
            ok: true,
            ctx: { companyId: 7n, userId: "editor", can: p => p === "documents.edit" },
        });
        jest.mocked(listObservations).mockResolvedValue([
            { id: "other", note: "A teammate's private source note" },
        ] as never);
        const input = {
            metricId: "active",
            value: 24,
            periodStart: "2026-11-16",
            periodEnd: "2026-11-22",
            note: "New note",
        };
        const created = { id: "new", ...input };
        jest.mocked(createObservation).mockResolvedValue(created as never);
        const response = await observations.POST(
            new NextRequest("http://localhost/api/vantage/metrics/observations", {
                method: "POST",
                body: JSON.stringify(input),
            })
        );
        expect(response.status).toBe(201);
        expect(await response.json()).toEqual({ observations: [created] });
        expect(createObservation).toHaveBeenCalledWith({ companyId: 7n, userId: "editor", input });
        expect(listObservations).not.toHaveBeenCalled();
    });

    it("returns 410 from retired agenda creation to editors without parsing the body", async () => {
        const response = await agendas.POST(
            new NextRequest("http://localhost/api/vantage/agendas", { method: "POST", body: "{" })
        );
        expect(response.status).toBe(410);
    });

    it("allows program deadlines with settings management", async () => {
        jest.mocked(vantageContext).mockResolvedValue({
            ok: true,
            ctx: { companyId: 7n, userId: "admin", can: p => p === "settings.manage" },
        });
        jest.mocked(listDeadlines).mockResolvedValue([]);
        expect((await deadlines.GET(new Request("http://localhost/deadlines"))).status).toBe(200);
        expect(listDeadlines).toHaveBeenCalledWith({ companyId: 7n, from: "2026-11-16" });
    });
});

describe("retained commitment ledger policy", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(vantageContext).mockResolvedValue({
            ok: true,
            ctx: { companyId: 7n, userId: "u", can: () => true },
        });
    });

    it("withholds source-denied linked actions while retaining explicit standalone sharing", async () => {
        const linked = {
            id: "linked",
            agendaId: "agenda",
            topicId: "topic",
            topicTitle: "Private agenda title",
        };
        const shared = { id: "shared", agendaId: null, topicId: null };
        const owned = { id: "owned", agendaId: null, topicId: null };
        jest.mocked(listCommitments).mockResolvedValue([linked, shared, owned] as CommitmentDto[]);
        mockStore.records.mockImplementation(async (_companyId, kind) =>
            kind === "cm"
                ? [
                      { ...linked, createdByUserId: "u", shared: true },
                      { ...shared, createdByUserId: "colleague", shared: true },
                      { ...owned, createdByUserId: "u", shared: false },
                  ]
                : [{ id: "source", createdByUserId: "other", kind: "document" }]
        );
        mockStore.topicAgendaId.mockResolvedValue("agenda");
        mockStore.agendaOwner.mockResolvedValue("u");
        mockStore.agenda.mockResolvedValue({
            id: "agenda",
            signals: null,
            topics: [{ facts: [{ refs: [{ ref: "ev:source" }] }], conflicts: [] }],
        } as unknown as AgendaDto);
        const response = await commitments.GET(new NextRequest("http://localhost/commitments"));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            commitments: [
                { ...shared, canEdit: false },
                { ...owned, canEdit: true },
            ],
        });
        expect(listCommitments).toHaveBeenCalledWith(
            expect.objectContaining({
                companyId: 7n,
                viewer: { userId: "u", canSeeProgramShares: true },
            })
        );
        expect(mockStore.records).toHaveBeenCalledWith(7n, "ev", ["source"]);
    });

    it("respects the program-only audience on a shared standalone action", async () => {
        jest.mocked(vantageContext).mockResolvedValue({
            ok: true,
            ctx: {
                companyId: 7n,
                userId: "u",
                can: p => p === "documents.read" || p === "documents.edit",
            },
        });
        const shared = { id: "shared", agendaId: null, topicId: null };
        jest.mocked(listCommitments).mockResolvedValue([shared] as CommitmentDto[]);
        mockStore.records.mockResolvedValueOnce([
            { ...shared, createdByUserId: "colleague", shared: true },
        ]);
        const response = await commitments.GET(new NextRequest("http://localhost/commitments"));
        expect(await response.json()).toEqual({ commitments: [] });
        expect(listCommitments).toHaveBeenCalledWith(
            expect.objectContaining({
                viewer: { userId: "u", canSeeProgramShares: false },
            })
        );
    });

    it.each([commitment.PATCH, commitment.DELETE])(
        "denies mutation of another creator's explicitly shared action",
        async handler => {
            mockStore.records.mockResolvedValueOnce([
                { id: "shared", createdByUserId: "colleague", shared: true },
            ]);
            const response = await handler(new NextRequest("http://localhost/commitments/shared"), {
                params: Promise.resolve({ id: "shared" }),
            });
            expect(response.status).toBe(403);
            expect(updateCommitment).not.toHaveBeenCalled();
            expect(deleteCommitment).not.toHaveBeenCalled();
        }
    );
});
