/**
 * Helpers for generating workspace slugs.
 *
 * Slugs are stored on `company.slug` and used as the URL handle in the
 * workspace selector. They must be unique. The `generateUniqueSlug` helper
 * picks a base slug from the workspace name and appends a numeric suffix
 * on collision.
 */

import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { company } from "@launchstack/store/schema";

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

/**
 * Suggest a workspace name nobody is using yet.
 *
 * The signup form pre-fills this and the person can edit it, so the job here
 * is only to hand them a starting point that will not be rejected. The
 * preferred name is their own ("Timothy's workspace"); when that is taken —
 * two users sharing a first name is ordinary, not exotic — a short random
 * token is appended rather than a counter, so the suggestion says nothing
 * about how many workspaces exist or what they are called.
 *
 * Availability is checked, not assumed, but it is still a suggestion: nothing
 * reserves the name, so a slow form and an unlucky collision can still be
 * refused at submit. That is fine — the field is editable, so the error is
 * something the person can act on.
 *
 * Note company.name has no uniqueness constraint in the database; only
 * company.slug does. This mirrors the signup route's application-level check.
 */
const TOKEN_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no look-alikes

function randomToken(length = 4): string {
    const bytes = randomBytes(length);
    let out = "";
    for (const byte of bytes) out += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length];
    return out;
}

async function companyNameTaken(name: string): Promise<boolean> {
    const [existing] = await db
        .select({ id: company.id })
        .from(company)
        .where(eq(company.name, name));
    return Boolean(existing);
}

export async function suggestAvailableCompanyName(preferred: string): Promise<string> {
    const base = preferred.trim() || "My workspace";
    if (!(await companyNameTaken(base))) return base;

    for (let attempt = 0; attempt < 12; attempt++) {
        const candidate = `${base} ${randomToken()}`;
        if (!(await companyNameTaken(candidate))) return candidate;
    }
    // 12 random tokens all colliding is not a real scenario; fall back to
    // something that cannot collide rather than looping or throwing.
    return `${base} ${Date.now().toString(36)}`;
}
