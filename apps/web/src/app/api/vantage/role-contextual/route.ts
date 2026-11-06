import { z } from "zod";
import { ContextPortErrorV0 } from "@launchstack/pipelines/vantage/context-v0";
import { roleContextualRoute } from "./_http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const input = z
    .object({
        weekStart: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .refine(value => {
                const instant = new Date(`${value}T00:00:00.000Z`);
                return (
                    Number.isFinite(instant.getTime()) &&
                    instant.toISOString().slice(0, 10) === value
                );
            }, "Invalid calendar date")
            .refine(
                value => value === "2026-10-26",
                "This frozen scenario uses the week of October 26, 2026"
            )
            .optional(),
    })
    .strict();
export async function GET(request: Request) {
    return roleContextualRoute(request, service => {
        const query = Object.fromEntries(new URL(request.url).searchParams);
        const parsed = input.safeParse(query);
        if (!parsed.success) throw new ContextPortErrorV0("Invalid review query.", 400);
        return service.load(parsed.data);
    });
}
export async function POST(request: Request) {
    return roleContextualRoute(request, async service => {
        const parsed = input.safeParse(await request.json().catch(() => null));
        if (!parsed.success) throw new ContextPortErrorV0("Invalid generation request.", 400);
        return service.generateWeek(parsed.data.weekStart);
    });
}
