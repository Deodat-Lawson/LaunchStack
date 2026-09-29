/**
 * The workspace's agent roster.
 *
 * GET seeds the starter agents on first read so the Agents pane is never an
 * empty state that the user has to escape from. The same roster serves
 * meetings, the chat composer's agent picker and `@handle` mentions.
 */

import { NextResponse } from "next/server";

import {
    AGENT_AUTONOMY_LEVELS,
    DEFAULT_AGENT_AUTONOMY,
    type AgentAutonomy,
} from "~/lib/agents/autonomy";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { CreatePersonaSchema } from "~/server/collab/agent-schemas";
import { createPersona, ensureStarterPersonas, listPersonas } from "~/server/collab/personas";
import { readWorkspaceSetting } from "~/server/settings/store";
import { getHub, listKnownNodes } from "~/server/collab/runtime";
import { getSlackStatus } from "~/server/collab/slack";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    const { companyId } = ctx.data;
    const includeArchived = new URL(request.url).searchParams.get("archived") === "1";

    // Seeding returns the live roster; `?archived=1` widens it for the Agents
    // page, which offers retired agents a way back.
    const seeded = await ensureStarterPersonas(companyId);
    const personas = includeArchived ? await listPersonas(companyId, true) : seeded;
    const hub = getHub();
    // Node bookkeeping must never take the roster down with it — a persona whose
    // node is unreachable is exactly when this page needs to render.
    const nodes = await listKnownNodes(companyId).catch((err: unknown) => {
        console.error("[collab] could not list worker nodes:", err);
        return hub?.listNodes() ?? [];
    });
    // The roster's default level, so the client can show an inherited level
    // without a second request — and fall back to the product default rather
    // than fail the roster if the settings store is unreachable.
    const defaultAutonomy = await readWorkspaceSetting<AgentAutonomy>(
        companyId,
        "agents.defaultAutonomy"
    ).catch(() => DEFAULT_AGENT_AUTONOMY);

    return NextResponse.json({
        personas,
        nodes,
        defaults: { autonomy: defaultAutonomy, autonomyLevels: AGENT_AUTONOMY_LEVELS },
        network: {
            enabled: Boolean(hub),
            hubId: hub?.hubId ?? null,
            /** Where a remote worker points `COLLAB_HUB_URL`. */
            hubPath: "/api/collab/hub",
        },
        slack: getSlackStatus(),
    });
}

export async function POST(request: Request) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    const parsed = CreatePersonaSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json(
            { error: "Invalid request", details: parsed.error.flatten() },
            { status: 400 }
        );
    }

    try {
        const persona = await createPersona(ctx.data.companyId, parsed.data);
        return NextResponse.json({ persona }, { status: 201 });
    } catch (err) {
        const message = err instanceof Error ? err.message : "Could not create agent";
        // The unique index on (company_id, key) is the real guard; report it as a
        // conflict rather than a 500 so the form can point at the field.
        const conflict = /duplicate key|unique/i.test(message);
        return NextResponse.json(
            {
                error: conflict
                    ? `An agent with the handle "${parsed.data.key}" already exists`
                    : message,
            },
            { status: conflict ? 409 : 500 }
        );
    }
}
