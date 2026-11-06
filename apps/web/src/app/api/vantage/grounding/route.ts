import { z } from "zod";
import { ContextPortErrorV0 } from "@launchstack/pipelines/vantage/context-v0";
import { groundingRoute } from "./_http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const baseline = z
    .object({
        activeReportId: z.string().uuid().nullable(),
        pointerVersion: z.number().int().nonnegative(),
        reportVersion: z.number().int().positive().nullable(),
        ciphertextHash: z
            .string()
            .regex(/^[a-f0-9]{32}$/)
            .nullable(),
    })
    .strict();
export async function GET(request: Request) {
    return groundingRoute(request, service => {
        if (new URL(request.url).search) throw new ContextPortErrorV0("Invalid review query.", 400);
        return service.load();
    });
}
export async function POST(request: Request) {
    return groundingRoute(request, async service => {
        const parsed = z
            .object({ expectedBaseline: baseline })
            .strict()
            .safeParse(await request.json().catch(() => null));
        if (!parsed.success)
            throw new ContextPortErrorV0("Invalid grounded generation request.", 400);
        return service.generateWeek(parsed.data.expectedBaseline);
    });
}
