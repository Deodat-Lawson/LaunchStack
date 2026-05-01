/**
 * Helpers for generating workspace slugs.
 *
 * Slugs are stored on `company.slug` and used as the URL handle in the
 * workspace selector. They must be unique. The `generateUniqueSlug` helper
 * picks a base slug from the workspace name and appends a numeric suffix
 * on collision.
 */

import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { company } from "@launchstack/core/db/schema";

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function slugifyName(name: string): string {
    const base = name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    if (!base) return "workspace";
    return base.length > 60 ? base.slice(0, 60) : base;
}

export function isValidSlug(slug: string): boolean {
    return SLUG_RE.test(slug);
}

export async function generateUniqueSlug(name: string): Promise<string> {
    const base = slugifyName(name);
    let candidate = base;
    let n = 1;
    // Cap retries — a runaway loop here shouldn't be possible but defend anyway.
    for (let attempt = 0; attempt < 50; attempt++) {
        const [existing] = await db
            .select({ id: company.id })
            .from(company)
            .where(eq(company.slug, candidate));
        if (!existing) return candidate;
        n += 1;
        candidate = `${base}-${n}`;
    }
    return `${base}-${Date.now()}`;
}
