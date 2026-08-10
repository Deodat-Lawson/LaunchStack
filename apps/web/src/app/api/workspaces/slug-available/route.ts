import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { company } from "@launchstack/core/db/schema";
import { requireClerkIdentity } from "~/lib/require-workspace-context";

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export async function GET(request: Request) {
    const identity = await requireClerkIdentity();
    if (!identity.success) return identity.response;

    const url = new URL(request.url);
    const slug = (url.searchParams.get("slug") ?? "").trim().toLowerCase();

    if (!slug || !SLUG_RE.test(slug)) {
        return NextResponse.json({ available: false, valid: false });
    }

    const [existing] = await db
        .select({ id: company.id })
        .from(company)
        .where(eq(company.slug, slug));

    return NextResponse.json({ available: !existing, valid: true });
}
