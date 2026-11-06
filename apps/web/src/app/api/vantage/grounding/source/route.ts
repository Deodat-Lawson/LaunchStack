import { z } from "zod";
import { ContextPortErrorV0 } from "@launchstack/pipelines/vantage/context-v0";
import { groundingRoute } from "../_http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const input = z
    .object({
        reportId: z.string().uuid(),
        kind: z.enum(["doc", "company", "public", "ev", "obs", "cm"]),
        id: z.string().min(1).max(200),
        version: z.string().min(1).max(200),
    })
    .strict();
export async function GET(request: Request) {
    return groundingRoute(request, async service => {
        const parsed = input.safeParse(Object.fromEntries(new URL(request.url).searchParams));
        if (!parsed.success) throw new ContextPortErrorV0("Invalid source request.", 400);
        const { reportId, ...ref } = parsed.data;
        return service.source(reportId, ref);
    });
}
