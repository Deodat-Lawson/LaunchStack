import { z } from "zod";
import { ContextPortErrorV0 } from "@launchstack/pipelines/vantage/context-v0";
import { contextRevisionSchema } from "~/lib/vantage/personal-context";
import { loadPersonalContext } from "~/server/vantage/personal-context";
import { contextBody, personalContextJson, personalContextRoute } from "../_http";
export const dynamic = "force-dynamic";
const schema = z.object({ expectedRevision: contextRevisionSchema }).strict();
export function POST(request: Request) {
    return personalContextRoute(async ctx => {
        const input = schema.safeParse(await contextBody(request));
        if (!input.success)
            throw new ContextPortErrorV0("Provide the current saved revision.", 400);
        const view = await loadPersonalContext(ctx, undefined, input.data.expectedRevision);
        if (!view.snapshot)
            return personalContextJson(
                {
                    error: "Resolve the unavailable starred documents before preparing a snapshot.",
                    diagnostics: view.diagnostics,
                },
                409
            );
        return view.snapshot;
    });
}
