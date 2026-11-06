import { z } from "zod";
import { ContextPortErrorV0 } from "@launchstack/pipelines/vantage/context-v0";
import { contextualRoute } from "../../_http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const review = z
    .object({
        topicId: z.string().min(1).max(200),
        expectedVersion: z.number().int().positive(),
        status: z.enum(["kept", "dismissed"]).optional(),
        decision: z
            .object({
                value: z.enum(["go", "no-go", "needs-more-evidence"]),
                text: z.string().max(1000).optional(),
            })
            .strict()
            .optional(),
    })
    .strict()
    .refine(value => value.status !== undefined || value.decision !== undefined);
type RouteContext = { params: Promise<{ id: string }> };
async function reportId(context: RouteContext) {
    const parsed = z
        .string()
        .uuid()
        .safeParse((await context.params).id);
    if (!parsed.success) throw new ContextPortErrorV0("Invalid report ID.", 400);
    return parsed.data;
}
export async function GET(request: Request, context: RouteContext) {
    return contextualRoute(request, async service =>
        service.load({ reportId: await reportId(context) })
    );
}
export async function PATCH(request: Request, context: RouteContext) {
    return contextualRoute(request, async service => {
        const parsed = review.safeParse(await request.json().catch(() => null));
        if (!parsed.success) throw new ContextPortErrorV0("Invalid human review.", 400);
        return service.review({ ...parsed.data, reportId: await reportId(context) });
    });
}
