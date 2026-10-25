/**
 * An agent as its definition file — markdown with front matter, the same
 * shape OpenCode and Claude Code read. `?download=1` sets a filename.
 */

import { localeOfRequest } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { agentFileName, serializeAgentFile } from "~/lib/agents/agent-file";
import { getPersonaById, personaToDefinition } from "~/server/collab/personas";

export const dynamic = "force-dynamic";

export async function GET(
    request: Request,
    { params }: { params: Promise<{ personaId: string }> }
) {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    const { personaId } = await params;
    const persona = await getPersonaById(ctx.data.companyId, personaId);
    if (!persona) {
        const t = translatorFor(localeOfRequest(request), "collab.server.errors");
        return new Response(t("agentNotFound"), { status: 404 });
    }

    const definition = personaToDefinition(persona);
    const headers: Record<string, string> = {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "no-store",
    };
    if (new URL(request.url).searchParams.get("download") === "1") {
        headers["Content-Disposition"] = `attachment; filename="${agentFileName(definition)}"`;
    }
    return new Response(serializeAgentFile(definition), { headers });
}
