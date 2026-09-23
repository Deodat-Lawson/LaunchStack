/**
 * Import an agent from its definition file.
 *
 * The file is parsed here, not in the browser, so what the API accepts and
 * what the preview showed are the same parse. A handle that already exists
 * is a 409 unless `replace` is set, in which case the existing agent is
 * updated in place and keeps its id — past transcripts still resolve.
 */

import { NextResponse } from "next/server";

import { AgentFileError, parseAgentFile } from "~/lib/agents/agent-file";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { ImportPersonaSchema, PersonaFieldsSchema } from "~/server/collab/agent-schemas";
import { createPersona, getPersonaByKey, updatePersona } from "~/server/collab/personas";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    const parsed = ImportPersonaSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json(
            { error: "Invalid request", details: parsed.error.flatten() },
            { status: 400 }
        );
    }

    let definition;
    let unknownKeys: string[];
    try {
        ({ definition, unknownKeys } = parseAgentFile(parsed.data.file));
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof AgentFileError ? err.message : "Could not read that file" },
            { status: 400 }
        );
    }

    const fields = PersonaFieldsSchema.safeParse({
        key: definition.key,
        displayName: definition.displayName,
        role: definition.role,
        systemPrompt: definition.systemPrompt,
        description: definition.description || null,
        mode: definition.mode,
        tools: definition.tools,
        style: definition.style,
        route: definition.route,
        temperature: definition.temperature,
        maxTurnChars: definition.maxTurnChars,
        accent: definition.accent,
        autonomy: definition.autonomy,
        nodeId: definition.nodeId,
    });
    if (!fields.success) {
        return NextResponse.json(
            {
                error: "The file parsed, but a field is out of range",
                details: fields.error.flatten(),
            },
            { status: 400 }
        );
    }

    const existing = await getPersonaByKey(ctx.data.companyId, fields.data.key);
    if (existing && !parsed.data.replace) {
        return NextResponse.json(
            {
                error: `An agent with the handle "${fields.data.key}" already exists`,
                conflict: { dbId: existing.dbId, displayName: existing.displayName },
            },
            { status: 409 }
        );
    }

    const persona = existing
        ? await updatePersona(ctx.data.companyId, existing.dbId, {
              ...fields.data,
              archived: false,
          })
        : await createPersona(ctx.data.companyId, fields.data);
    if (!persona) return NextResponse.json({ error: "Could not save the agent" }, { status: 500 });

    return NextResponse.json(
        { persona, replaced: Boolean(existing), unknownKeys },
        { status: existing ? 200 : 201 }
    );
}
