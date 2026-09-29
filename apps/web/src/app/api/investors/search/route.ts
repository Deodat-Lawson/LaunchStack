/**
 * GET /api/investors/search?q=climate,health&state=CA&within=365&spvs=1
 *
 * Venture funds raising now, from SEC Form D filings. Any member may search:
 * the filings are public, and only the words and state typed here leave the
 * deployment (see the privacy overview).
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { findInvestors } from "@launchstack/tools/investor-search";

import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";

export const dynamic = "force-dynamic";

/** How far back a filing may be: a month, a quarter, half a year, a year. */
const WITHIN_DAYS = [30, 90, 180, 365] as const;

const QuerySchema = z.object({
    q: z.string().max(200).optional(),
    state: z
        .string()
        .regex(/^[A-Za-z0-9]{2}$/)
        .optional(),
    within: z.coerce
        .number()
        .refine(n => (WITHIN_DAYS as readonly number[]).includes(n))
        .default(365),
    spvs: z.enum(["0", "1"]).default("0"),
    limit: z.coerce.number().int().min(1).max(40).default(20),
});

export async function GET(request: NextRequest) {
    return withRateLimit(request, RateLimitPresets.standard, async () => {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const parsed = QuerySchema.safeParse(
            Object.fromEntries(
                [...request.nextUrl.searchParams.entries()].filter(([, value]) => value !== "")
            )
        );
        if (!parsed.success) {
            return NextResponse.json(
                { error: "Invalid search", details: parsed.error.flatten().fieldErrors },
                { status: 400 }
            );
        }
        const { q, state, within, spvs, limit } = parsed.data;
        const since = new Date(Date.now() - within * 24 * 3600_000).toISOString().slice(0, 10);

        try {
            const result = await findInvestors(
                {
                    keywords: q ? [q] : [],
                    state,
                    since,
                    limit,
                    includeSingleDealVehicles: spvs === "1",
                },
                { signal: request.signal }
            );
            return NextResponse.json(result);
        } catch (err) {
            console.error("[investors] SEC search failed", err);
            return NextResponse.json(
                { error: "SEC EDGAR did not answer. Try again in a moment." },
                { status: 502 }
            );
        }
    });
}
