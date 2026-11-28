import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { reviewActor, reviewError } from "~/app/api/vantage/reviews/_http";
import { vantageV2Enabled } from "./enabled";
export async function vantageV2Actor(mutate = false) {
    const auth = await reviewActor(mutate);
    if (!auth.ok) return auth;
    if (!vantageV2Enabled())
        return {
            ok: false as const,
            response: NextResponse.json({ error: "vantage_v2_disabled" }, { status: 404 }),
        };
    if (mutate && !auth.ctx.can("documents.read"))
        return {
            ok: false as const,
            response: NextResponse.json({ error: "review_access_denied" }, { status: 403 }),
        };
    return auth;
}
export function vantageV2Error(error: unknown) {
    if (error instanceof ZodError || error instanceof SyntaxError)
        return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    return reviewError(error);
}
