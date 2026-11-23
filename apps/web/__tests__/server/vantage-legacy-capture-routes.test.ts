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
    isIsoDate: () => true,
    listEvidence: jest.fn(),
    createEvidence: jest.fn(),
    updateEvidence: jest.fn(),
    deleteEvidence: jest.fn(),
    listMetricDefinitionRows: jest.fn(),
    toDefinitionDto: (row: unknown) => row,
    listObservations: jest.fn(),
    createMetricDefinition: jest.fn(),
    createObservations: jest.fn(),
    ensureMetricDefinitions: jest.fn(),
}));
jest.mock("~/app/api/vantage/_schemas", () => ({
    EvidenceSchema: {
        safeParse: (data: unknown) => ({ success: true, data }),
        partial() {
            return this;
        },
    },
}));
jest.mock("~/server/vantage/legacy-read-authority", () => ({
    filterLegacyEvidenceRead: jest.fn(),
    authorizeLegacyEvidenceMutation: jest.fn(),
}));
import { NextRequest } from "next/server";
import {
    filterLegacyEvidenceRead,
    authorizeLegacyEvidenceMutation,
} from "~/server/vantage/legacy-read-authority";
import {
    listEvidence,
    createEvidence,
    updateEvidence,
    deleteEvidence,
    listMetricDefinitionRows,
    listObservations,
    ensureMetricDefinitions,
} from "@launchstack/pipelines/vantage";
import { vantageContext } from "~/app/api/vantage/_http";
import * as evidence from "~/app/api/vantage/evidence/route";
import * as evidenceItem from "~/app/api/vantage/evidence/[id]/route";
import * as metrics from "~/app/api/vantage/metrics/route";
import * as metricItem from "~/app/api/vantage/metrics/[id]/route";
import * as observations from "~/app/api/vantage/metrics/observations/route";
import * as observation from "~/app/api/vantage/metrics/observations/[id]/route";
import * as metricImport from "~/app/api/vantage/metrics/import/route";
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
    it("serializes only evidence selected by the creator/shared/source reader", async () => {
        jest.mocked(listEvidence).mockResolvedValue([{ id: "private" }, { id: "shared" }] as never);
        jest.mocked(filterLegacyEvidenceRead).mockResolvedValue([{ id: "shared" }] as never);
        const response = await evidence.GET(new NextRequest("http://localhost/evidence"));
        expect(await response.json()).toEqual({ evidence: [{ id: "shared" }] });
        expect(listEvidence).toHaveBeenCalledWith(expect.objectContaining({ companyId: 7n }));
    });
    it("cannot create a document capture with unregistered source authority", async () => {
        const response = await evidence.POST(
            new NextRequest("http://localhost/evidence", {
                method: "POST",
                body: JSON.stringify({ kind: "document" }),
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
});
