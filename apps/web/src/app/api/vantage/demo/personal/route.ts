import type { NextRequest } from "next/server";
import { z } from "zod";
import { ContextPortErrorV0 } from "@launchstack/pipelines/vantage/context-v0";
import {
    createVantageContextDemoService,
    assertVantageContextDemoEnabled,
} from "~/server/vantage/demo-service";
import { WeekSchema, demoFailure, json, readBody } from "../_http";
export const dynamic = "force-dynamic";
const revision = z.number().int().nonnegative();
const change = z.discriminatedUnion("operation", [
    z
        .object({
            operation: z.literal("roles"),
            roleIds: z.array(z.string().min(1).max(80)).max(16),
            primaryRoleId: z.string().min(1).max(80).optional(),
            expectedRevision: revision,
            week: WeekSchema.optional(),
        })
        .strict(),
    z
        .object({
            operation: z.literal("star"),
            documentId: z.string().regex(/^workspace-document\/[1-9]\d*$/),
            starred: z.boolean(),
            expectedRevision: revision,
            week: WeekSchema.optional(),
        })
        .strict(),
]);
function failure(error: unknown) {
    if (error instanceof ContextPortErrorV0)
        return json(
            { error: "Personal context is unavailable or changed. Reload before saving." },
            error.status
        );
    return demoFailure("personal context demo", error);
}
export async function GET(request: NextRequest) {
    try {
        assertVantageContextDemoEnabled();
        const week = request.nextUrl.searchParams.get("week") ?? undefined;
        if (week && !WeekSchema.safeParse(week).success)
            return json({ error: "Choose a configured reporting week." }, 400);
        return json(await createVantageContextDemoService().personalContext(week));
    } catch (error) {
        return failure(error);
    }
}
export async function PATCH(request: NextRequest) {
    try {
        assertVantageContextDemoEnabled();
        const parsed = change.safeParse(await readBody(request));
        if (!parsed.success)
            return json(
                { error: "Provide a valid role or star change and current revision." },
                400
            );
        const { week, ...mutation } = parsed.data;
        const selectedWeek = week ?? request.nextUrl.searchParams.get("week") ?? undefined;
        if (selectedWeek && !WeekSchema.safeParse(selectedWeek).success)
            return json({ error: "Choose a configured reporting week." }, 400);
        return json(await createVantageContextDemoService().updatePersonal(selectedWeek, mutation));
    } catch (error) {
        return failure(error);
    }
}
