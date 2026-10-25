/**
 * Import an agent from its definition file.
 *
 * The file is parsed here, not in the browser, so what the API accepts and
 * what the preview showed are the same parse. A handle that already exists
 * is a 409 unless `replace` is set, in which case the existing agent is
 * updated in place and keeps its id — past transcripts still resolve.
 *
 * An import adds to the roster or overwrites a whole agent, policy fields and
 * all, so it is the roster managers' (see `lib/agents/roster-access.ts`).
 */

import { NextResponse } from "next/server";

import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";

import { parseAgentFile } from "~/lib/agents/agent-file";
import { fileErrorMessage, type AgentsTranslator } from "~/lib/agents/i18n";
import { AGENT_ROSTER_PERMISSION } from "~/lib/agents/roster-access";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { ImportPersonaSchema, PersonaFieldsSchema } from "~/server/collab/agent-schemas";
import { createPersona, getPersonaByKey, updatePersona } from "~/server/collab/personas";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    const ctx = await requireWorkspacePermission(AGENT_ROSTER_PERMISSION);
    if (!ctx.success) return ctx.response;
    const locale = localeOfRequest(request);
    const t = translatorFor(locale, "collab.server.errors");

    const parsed = ImportPersonaSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json(
            {
                error: translatorFor(locale, "errors.api")("invalidRequest"),
                details: parsed.error.flatten(),
            },
            { status: 400 }
        );
    }

    let definition;
    let unknownKeys: string[];
    try {
        ({ definition, unknownKeys } = parseAgentFile(parsed.data.file));
    } catch (err) {
        return NextResponse.json(
            // The definition-file errors the import preview shows (`agents.fileErrors`).
            {
                error: fileErrorMessage(
                    translatorFor(locale, "agents") as unknown as AgentsTranslator,
                    err
                ),
            },
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
        avatarUrl: definition.avatarUrl,
        autonomy: definition.autonomy,
        nodeId: definition.nodeId,
    });
    if (!fields.success) {
        return NextResponse.json(
            {
                error: t("fileOutOfRange"),
                details: fields.error.flatten(),
            },
            { status: 400 }
        );
    }

    const existing = await getPersonaByKey(ctx.data.companyId, fields.data.key);
    if (existing && !parsed.data.replace) {
        return NextResponse.json(
            {
                error: t("handleTaken", { handle: fields.data.key }),
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
    if (!persona) return NextResponse.json({ error: t("saveAgentFailed") }, { status: 500 });

    return NextResponse.json(
        { persona, replaced: Boolean(existing), unknownKeys },
        { status: existing ? 200 : 201 }
    );
}
