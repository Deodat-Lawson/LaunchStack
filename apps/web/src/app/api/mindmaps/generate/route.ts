/**
 * "Generate with AI" — a new mindmap draft from a description.
 *
 * The workspace's model writes the diagram as an outline or a Mermaid
 * flowchart (`~/server/mindmap/generate`), `buildDiagram` turns that into a
 * document lit for the creator's app theme, and it is saved the way the
 * gallery saves a template (`createMindmapDraft`): no folder is the person's
 * Private section; a folder takes edit access to it. The call is counted
 * under the `mindmap` AI feature and refused at the person's allowance.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { DIAGRAM_TYPES, DiagramSpecError } from "~/app/employer/documents/_mindmap/model/generate";
import { localeOfRequest, requestTranslator } from "~/i18n/server";
import { translatorFor } from "~/i18n/translate";
import { isUnfiledFolder, normalizeFolderPath } from "~/lib/folders/path";
import { describeChatResolutionFailure } from "~/lib/models";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { serverError, validateRequestBody } from "~/lib/validation";
import { refuseAtAiAllowance } from "~/server/ai-usage/refusal";
import { describeFolderPathProblem } from "~/server/folders/words";
import { describeDraftAccess } from "~/server/mindmap/access";
import { createDiagram, creatorThemeMode, DraftFolderError } from "~/server/mindmap/agent";
import { generateDiagramSpec, MAX_PROMPT_CHARS } from "~/server/mindmap/generate";
import { toDetail } from "~/server/mindmap/repository";
import { withWorkspaceChatModels } from "~/server/workspace-models/scope";

export const runtime = "nodejs";
export const maxDuration = 120;

const GenerateSchema = z.object({
    prompt: z.string().trim().min(1).max(MAX_PROMPT_CHARS),
    type: z.enum(DIAGRAM_TYPES).optional(),
    folder: z.string().max(256).optional(),
    mode: z.enum(["light", "dark"]).optional(),
});

export async function POST(request: Request) {
    return withRateLimit(request, RateLimitPresets.strict, () => handle(request));
}

async function handle(request: Request) {
    const t = requestTranslator(request, "mindmap.server.errors");
    const locale = localeOfRequest(request);
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const validation = await validateRequestBody(request, GenerateSchema);
        if (!validation.success) return validation.response;
        const body = validation.data;

        const folder = normalizeFolderPath(body.folder);
        if (!isUnfiledFolder(folder)) {
            const invalid = describeFolderPathProblem(folder, request);
            if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
        }

        const refused = await refuseAtAiAllowance(ctx.data.companyId, ctx.data.authUserId, locale);
        if (refused) return refused;

        let spec;
        try {
            spec = await withWorkspaceChatModels(
                ctx.data.companyId,
                { feature: "mindmap", userId: ctx.data.authUserId },
                () => generateDiagramSpec(body.prompt, body.type)
            );
        } catch (error) {
            const described = describeChatResolutionFailure(error, locale);
            if (described.status !== 500) {
                return NextResponse.json(
                    { error: described.message },
                    { status: described.status }
                );
            }
            console.error("[mindmaps] generate: the model call failed:", error);
            return NextResponse.json({ error: t("generateFailed") }, { status: 502 });
        }

        try {
            const { row } = await createDiagram(ctx.data, {
                spec,
                folder,
                mode: body.mode ?? creatorThemeMode(request.headers.get("cookie")),
                pageName: translatorFor(locale, "mindmap.pages")("numbered", { number: 1 }),
            });
            const [access] = (await describeDraftAccess(ctx.data, [row])).values();
            return NextResponse.json({ mindmap: { ...toDetail(row), access } }, { status: 201 });
        } catch (error) {
            if (error instanceof DiagramSpecError) {
                return NextResponse.json({ error: t("generateFailed") }, { status: 422 });
            }
            if (error instanceof DraftFolderError) {
                return NextResponse.json(
                    {
                        error:
                            error.reason === "denied"
                                ? requestTranslator(
                                      request,
                                      "sources.server.errors"
                                  )("folderEditDenied")
                                : error.message,
                    },
                    { status: error.reason === "denied" ? 403 : 400 }
                );
            }
            throw error;
        }
    } catch (error) {
        console.error("[mindmaps] generate failed:", error);
        return serverError(t("generateFailed"));
    }
}
