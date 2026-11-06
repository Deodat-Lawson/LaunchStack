import { z } from "zod";
import { ContextPortErrorV0 } from "@launchstack/pipelines/vantage/context-v0";
import { groundingRoute } from "../_http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const input = z
    .object({
        expectedRevision: z.number().int().nonnegative(),
        expectedProjectionFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        state: z.enum(["reviewed", "unknowns-marked"]),
    })
    .strict();
export async function GET(request: Request) {
    return groundingRoute(request, service => service.architectureState());
}
export async function POST(request: Request) {
    return groundingRoute(request, async service => {
        const parsed = input.safeParse(await request.json().catch(() => null));
        if (!parsed.success) throw new ContextPortErrorV0("Invalid architecture review.", 400);
        return service.reviewArchitecture(parsed.data);
    });
}
