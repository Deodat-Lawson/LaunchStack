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

import type { Locale } from "~/i18n/locales";
import { localeOfRequest } from "~/i18n/server";
import { translatorFor, wordEnglish } from "~/i18n/translate";
import {
    AGENT_CONTENT_PERMISSION,
    AGENT_ROSTER_PERMISSION,
    agentRosterAccess,
    policyFieldsIn,
    type AgentPolicyField,
} from "~/lib/agents/roster-access";
import {
    forbiddenForPermission,
    requireWorkspaceContext,
    requireWorkspacePermission,
} from "~/lib/require-workspace-context";
import { UpdatePersonaSchema } from "~/server/collab/agent-schemas";
import { archivePersona, getPersonaById, updatePersona } from "~/server/collab/personas";

export const dynamic = "force-dynamic";

/** "handle, autonomy and tools" — `describePolicyFields` in the reader's language. */
function policyFieldList(fields: readonly AgentPolicyField[], locale: Locale): string {
    const t = translatorFor(locale, "collab");
    const labels = fields.map(field => t(`server.policyFields.${field}`));
    if (labels.length <= 1) return labels.join("");
    return t("shared.listPair", {
        first: labels.slice(0, -1).join(t("shared.listSeparator")),
        last: labels[labels.length - 1]!,
    });
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ personaId: string }> }
) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    const t = translatorFor(localeOfRequest(request), "collab.server.errors");

    const { personaId } = await params;
    const persona = await getPersonaById(ctx.data.companyId, personaId);
    if (!persona) return NextResponse.json({ error: t("agentNotFound") }, { status: 404 });
    return NextResponse.json({ persona });
}

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ personaId: string }> }
) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;
    const locale = localeOfRequest(request);
    const t = translatorFor(locale, "collab.server.errors");

    const access = agentRosterAccess(permission => ctx.data.can(permission));
    if (!access.editContent) return forbiddenForPermission(AGENT_CONTENT_PERMISSION, locale);

    const parsed = UpdatePersonaSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json(
            {
                error: translatorFor(locale, "errors.api")("invalidRequest"),
                details: parsed.error.flatten(),
            },
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
                    error: t("policyLocked", { fields: policyFieldList(locked, locale) }),
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
        if (!persona) return NextResponse.json({ error: t("agentNotFound") }, { status: 404 });
        return NextResponse.json({ persona });
    } catch (err) {
        const message = err instanceof Error ? err.message : t("saveAgentFailed");
        const conflict = /duplicate key|unique/i.test(message);
        return NextResponse.json(
            {
                error: conflict
                    ? t("handleTaken", { handle: parsed.data.key ?? "" })
                    : wordEnglish(message, "collab.server.errors", locale),
            },
            { status: conflict ? 409 : 500 }
        );
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ personaId: string }> }
) {
    const ctx = await requireWorkspacePermission(AGENT_ROSTER_PERMISSION);
    if (!ctx.success) return ctx.response;
    const t = translatorFor(localeOfRequest(request), "collab.server.errors");

    const { personaId } = await params;
    const persona = await archivePersona(ctx.data.companyId, personaId);
    if (!persona) return NextResponse.json({ error: t("agentNotFound") }, { status: 404 });
    return NextResponse.json({ persona, archived: true });
}
