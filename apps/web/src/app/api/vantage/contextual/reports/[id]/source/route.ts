import { z } from "zod";
import { ContextPortErrorV0 } from "@launchstack/pipelines/vantage/context-v0";
import { contextualRoute } from "../../../_http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const source = z
    .object({
        kind: z.enum(["company", "doc", "ev", "obs", "cm", "public"]),
        id: z.string().min(1).max(300),
        version: z.string().min(1).max(300),
    })
    .strict();
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
    return contextualRoute(request, async service => {
        const parsed = source.safeParse(Object.fromEntries(new URL(request.url).searchParams));
        if (!parsed.success) throw new ContextPortErrorV0("Invalid source reference.", 400);
        const id = z
            .string()
            .uuid()
            .safeParse((await context.params).id);
        if (!id.success) throw new ContextPortErrorV0("Invalid report ID.", 400);
        return service.source(id.data, parsed.data);
    });
}
