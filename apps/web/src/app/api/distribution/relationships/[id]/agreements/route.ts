// GET  /api/distribution/relationships/[id]/agreements
// POST /api/distribution/relationships/[id]/agreements — terms; required to enter "contracted"
import type { NextRequest } from "next/server";

import { AgreementInputSchema } from "@launchstack/pipelines/distribution/types";
import {
    addEvent,
    createAgreement,
    getRelationship,
    listAgreements,
} from "@launchstack/pipelines/distribution/db";
import { requestTranslator } from "~/i18n/server";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { error, json, readJsonBody } from "~/server/distribution/http";
import { distributionRouteError } from "~/server/distribution/stage-errors";

const api = (request: Request) => requestTranslator(request, "errors.api");

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        const { id } = await params;
        const relationship = await getRelationship(id, ctx.data.companyId);
        if (!relationship) return error(api(request)("notFound"), 404);
        return json({ agreements: await listAgreements(ctx.data.companyId, id) });
    } catch (err) {
        return distributionRouteError("GET agreements", err, request);
    }
}

export async function POST(request: NextRequest, { params }: Params) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        const { id } = await params;
        const relationship = await getRelationship(id, ctx.data.companyId);
        if (!relationship) return error(api(request)("notFound"), 404);
        const parsed = AgreementInputSchema.safeParse(await readJsonBody(request));
        if (!parsed.success)
            return error(api(request)("validationFailed"), 400, {
                details: parsed.error.flatten(),
            });
        const agreement = await createAgreement({
            companyId: ctx.data.companyId,
            relationshipId: id,
            input: parsed.data,
        });
        await addEvent({
            companyId: ctx.data.companyId,
            relationshipId: id,
            type: "agreement_signed",
            payload: {
                agreementId: agreement.id,
                exclusivity: agreement.exclusivity,
                endsOn: agreement.endsOn,
            },
            actorUserId: ctx.data.authUserId,
            ref: agreement.id,
        });
        return json({ agreement }, 201);
    } catch (err) {
        return distributionRouteError("POST agreements", err, request);
    }
}
