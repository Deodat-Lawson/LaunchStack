/**
 * Restores a starter agent to the definition it shipped with. Custom agents
 * have nothing to restore to and get a 409 rather than a silent no-op.
 *
 * A restore rewrites autonomy and tools and un-retires, so it is the roster
 * managers' (see `lib/agents/roster-access.ts`).
 */

import { NextResponse } from "next/server";

import { AGENT_ROSTER_PERMISSION } from "~/lib/agents/roster-access";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { getPersonaById, resetStarterPersona } from "~/server/collab/personas";

export const dynamic = "force-dynamic";

export async function POST(
    _request: Request,
    { params }: { params: Promise<{ personaId: string }> }
) {
    const ctx = await requireWorkspacePermission(AGENT_ROSTER_PERMISSION);
    if (!ctx.success) return ctx.response;

    const { personaId } = await params;
    const current = await getPersonaById(ctx.data.companyId, personaId);
    if (!current) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

    const persona = await resetStarterPersona(ctx.data.companyId, personaId);
    if (!persona) {
        return NextResponse.json(
            {
                error: `@${current.id} is not a starter agent, so there is no shipped version to restore`,
            },
            { status: 409 }
        );
    }
    return NextResponse.json({ persona });
}
