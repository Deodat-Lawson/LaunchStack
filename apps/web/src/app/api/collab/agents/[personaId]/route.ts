/**
 * Editing and retiring a single agent persona.
 *
 * DELETE archives rather than removing: persona ids appear in past transcripts
 * and in frozen meeting rosters, and those must keep resolving.
 *
 * PATCH takes two permissions (see `lib/agents/roster-access.ts`): anyone who
 * edits documents may change what an agent says; only the roster's managers
 * may change its handle, autonomy, tools, model route or node. DELETE is the
 * managers' alone.
 */

import { NextResponse } from "next/server";

import {
    AGENT_CONTENT_PERMISSION,
    AGENT_ROSTER_PERMISSION,
    agentRosterAccess,
    describePolicyFields,
    policyFieldsIn,
} from "~/lib/agents/roster-access";
import {
    forbiddenForPermission,
    requireWorkspaceContext,
    requireWorkspacePermission,
} from "~/lib/require-workspace-context";
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

    const access = agentRosterAccess(permission => ctx.data.can(permission));
    if (!access.editContent) return forbiddenForPermission(AGENT_CONTENT_PERMISSION);

    const parsed = UpdatePersonaSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json(
            { error: "Invalid request", details: parsed.error.flatten() },
            { status: 400 }
        );
    }

    // Refused rather than dropped: a save that quietly kept the old autonomy
    // would look like it worked.
    if (!access.manageRoster) {
        const locked = policyFieldsIn(parsed.data);
        if (locked.length > 0) {
            return NextResponse.json(
                {
                    error: `Only people who can manage workspace settings can change an agent's ${describePolicyFields(locked)}.`,
                    permission: AGENT_ROSTER_PERMISSION,
                    fields: locked,
                },
                { status: 403 }
            );
        }
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
    const ctx = await requireWorkspacePermission(AGENT_ROSTER_PERMISSION);
    if (!ctx.success) return ctx.response;

    const { personaId } = await params;
    const persona = await archivePersona(ctx.data.companyId, personaId);
    if (!persona) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    return NextResponse.json({ persona, archived: true });
}
