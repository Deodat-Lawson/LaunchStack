// GET /api/vantage/agendas/:id/update?private=1 — the weekly update as Markdown.
// Shared topics and commitments only, unless the founder asks for their own copy.
import type { NextRequest } from "next/server";

import {
    REF_PREFIX,
    getAgenda,
    listCommitments,
    listEvidenceByIds,
    renderWeeklyUpdate,
} from "@launchstack/pipelines/vantage";

import { error, handleVantageError, json, vantageContext } from "../../../_http";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
    const auth = await vantageContext();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        const agenda = await getAgenda({ companyId: auth.ctx.companyId, id });
        if (!agenda) return error("That agenda is not here.", 404);
        const commitments = await listCommitments({ companyId: auth.ctx.companyId, agendaId: id });
        const includePrivate = request.nextUrl.searchParams.get("private") === "1";
        // Which cited notes are private, so the shared copy can withhold them.
        const prefix = `${REF_PREFIX.evidence}:`;
        const citedIds = [
            ...new Set(
                agenda.topics
                    .flatMap(t => [...t.facts, ...t.conflicts])
                    .flatMap(f => f.refs)
                    .map(r => r.ref)
                    .filter(ref => ref.startsWith(prefix))
                    .map(ref => ref.slice(prefix.length))
            ),
        ];
        const cited = await listEvidenceByIds({ companyId: auth.ctx.companyId, ids: citedIds });
        const privateRefs = new Set(
            cited.filter(e => e.visibility === "private").map(e => `${prefix}${e.id}`)
        );
        const markdown = renderWeeklyUpdate({ agenda, commitments, includePrivate, privateRefs });
        return json({ markdown });
    } catch (err) {
        return handleVantageError("GET update", err);
    }
}
