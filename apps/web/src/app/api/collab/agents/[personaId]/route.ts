/**
 * Editing and retiring a single agent persona.
 *
 * DELETE archives rather than removing: persona ids appear in past transcripts
 * and in frozen meeting rosters, and those must keep resolving.
 */

import { NextResponse } from "next/server";

import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { UpdatePersonaSchema } from "~/server/collab/agent-schemas";
import { archivePersona, getPersonaById, updatePersona } from "~/server/collab/personas";

export const dynamic = "force-dynamic";

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ personaId: string }> }
) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    const { personaId } = await params;
    const persona = await getPersonaById(ctx.data.companyId, personaId);
    if (!persona) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    return NextResponse.json({ persona });
}

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ personaId: string }> }
) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    const parsed = UpdatePersonaSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json(
            { error: "Invalid request", details: parsed.error.flatten() },
            { status: 400 }
        );
    }

    const { personaId } = await params;
    try {
        const persona = await updatePersona(ctx.data.companyId, personaId, parsed.data);
        if (!persona) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
        return NextResponse.json({ persona });
    } catch (err) {
        const message = err instanceof Error ? err.message : "Could not save the agent";
        const conflict = /duplicate key|unique/i.test(message);
        return NextResponse.json(
            {
                error: conflict
                    ? `An agent with the handle "${parsed.data.key ?? ""}" already exists`
                    : message,
            },
            { status: conflict ? 409 : 500 }
        );
    }
}

export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ personaId: string }> }
) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    const { personaId } = await params;
    const persona = await archivePersona(ctx.data.companyId, personaId);
    if (!persona) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    return NextResponse.json({ persona, archived: true });
}
