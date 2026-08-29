/**
 * One-off cutover import: Clerk user export → better-auth tables.
 *
 *   pnpm --filter @launchstack/web exec tsx ./scripts/import-clerk-users.ts <export.json>
 *   pnpm --filter @launchstack/web exec tsx ./scripts/import-clerk-users.ts <export.json> --execute
 *
 * Dry-run by default: parses, normalizes, and prints what it WOULD write,
 * plus the verification report, without touching the database. `--execute`
 * performs the writes. Idempotent — every write is an upsert keyed on the
 * preserved Clerk ID, so a partial run can simply be re-run.
 *
 * Input: a JSON array of Clerk users (the dashboard/API export shape). Per
 * user this reads: `id`, name (`first_name`/`last_name`), the primary email
 * from `email_addresses` + `primary_email_address_id`, the bcrypt hash from
 * `password_digest` (present only in a hashes-included export), and any
 * `external_accounts` (OAuth identities).
 *
 * What it writes:
 *   - auth_user     with the PRESERVED Clerk id — `users.userId` already
 *                    stores these strings, so no app-table migration exists.
 *   - auth_account  providerId "credential", issuer "local:credential",
 *                    accountId = user id, password = the bcrypt digest
 *                    (verified at sign-in by the bcrypt branch in
 *                    src/server/auth/index.ts).
 *   - auth_account  one row per OAuth identity, issuer "local:<provider>".
 *
 * Verification (always runs, and a mismatch exits non-zero):
 *   1. Every `users.userId` in the app table has a matching auth_user row.
 *   2. Every export user with a password digest has a credential account.
 * Abort the cutover if either fails.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { authAccount, authUser } from "../src/server/db/schema/auth";
import { users } from "../src/server/db/schema/identity";

// Root .env, same resolution as src/env.ts; already-set vars win.
loadDotenv({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

type ClerkEmail = {
    id?: string;
    email_address?: string;
};

type ClerkExternalAccount = {
    provider?: string; // e.g. "oauth_google"
    provider_user_id?: string;
};

type ClerkUser = {
    id?: string;
    first_name?: string | null;
    last_name?: string | null;
    username?: string | null;
    email_addresses?: ClerkEmail[];
    primary_email_address_id?: string | null;
    password_digest?: string | null;
    external_accounts?: ClerkExternalAccount[];
    created_at?: number | string | null;
};

type NormalizedUser = {
    id: string;
    name: string;
    email: string;
    passwordDigest: string | null;
    oauth: { providerId: string; accountId: string }[];
    createdAt: Date;
};

function normalize(raw: ClerkUser, index: number): NormalizedUser {
    if (!raw.id) throw new Error(`export[${index}]: missing id`);
    const emails = raw.email_addresses ?? [];
    const primary = emails.find(e => e.id && e.id === raw.primary_email_address_id) ?? emails[0];
    const email = primary?.email_address?.trim().toLowerCase();
    if (!email) throw new Error(`export[${index}] (${raw.id}): no email address`);

    const name =
        [raw.first_name, raw.last_name].filter(Boolean).join(" ").trim() ||
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty-string username must fall through to email, same as the empty joined name above; ?? would import "" as a display name
        raw.username?.trim() ||
        email;

    const digest = raw.password_digest?.trim() ?? null;
    if (digest && !digest.startsWith("$2")) {
        // The verify branch in src/server/auth only handles bcrypt for
        // imported hashes; anything else must be investigated, not imported.
        throw new Error(`export[${index}] (${raw.id}): non-bcrypt password_digest`);
    }

    const oauth = (raw.external_accounts ?? [])
        .filter(a => a.provider && a.provider_user_id)
        .map(a => ({
            providerId: a.provider!.replace(/^oauth_/, ""),
            accountId: a.provider_user_id!,
        }));

    const createdMs = typeof raw.created_at === "number" ? raw.created_at : Date.now();
    return {
        id: raw.id,
        name,
        email,
        passwordDigest: digest,
        oauth,
        createdAt: new Date(createdMs),
    };
}

async function main() {
    const [, , exportPath, ...flags] = process.argv;
    const execute = flags.includes("--execute");
    if (!exportPath) {
        console.error("Usage: tsx scripts/import-clerk-users.ts <export.json> [--execute]");
        process.exit(2);
    }
    if (!process.env.DATABASE_URL) {
        console.error("DATABASE_URL is not set");
        process.exit(2);
    }

    const parsed: unknown = JSON.parse(readFileSync(exportPath, "utf8"));
    if (!Array.isArray(parsed)) {
        console.error("Export must be a JSON array of Clerk users");
        process.exit(2);
    }
    const imported = (parsed as ClerkUser[]).map(normalize);

    const client = postgres(process.env.DATABASE_URL, { max: 1 });
    const db = drizzle(client, { schema: { authUser, authAccount, users } });

    const now = new Date();
    let credentialRows = 0;
    let oauthRows = 0;

    for (const user of imported) {
        if (execute) {
            await db
                .insert(authUser)
                .values({
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    // These users signed in through Clerk, which verified
                    // their address; without this, optional verification
                    // gates would re-challenge every migrated account.
                    emailVerified: true,
                    createdAt: user.createdAt,
                    updatedAt: now,
                })
                .onConflictDoUpdate({
                    target: authUser.id,
                    set: { name: user.name, email: user.email, updatedAt: now },
                });
        }

        if (user.passwordDigest) {
            credentialRows += 1;
            if (execute) {
                await db
                    .insert(authAccount)
                    .values({
                        id: `imported-credential-${user.id}`,
                        issuer: "local:credential",
                        providerId: "credential",
                        accountId: user.id,
                        userId: user.id,
                        password: user.passwordDigest,
                        createdAt: user.createdAt,
                        updatedAt: now,
                    })
                    .onConflictDoUpdate({
                        target: authAccount.id,
                        set: { password: user.passwordDigest, updatedAt: now },
                    });
            }
        }

        for (const identity of user.oauth) {
            oauthRows += 1;
            if (execute) {
                await db
                    .insert(authAccount)
                    .values({
                        id: `imported-${identity.providerId}-${user.id}`,
                        issuer: `local:${identity.providerId}`,
                        providerId: identity.providerId,
                        accountId: identity.accountId,
                        userId: user.id,
                        createdAt: user.createdAt,
                        updatedAt: now,
                    })
                    .onConflictDoUpdate({
                        target: authAccount.id,
                        set: { accountId: identity.accountId, updatedAt: now },
                    });
            }
        }
    }

    console.log(
        `${execute ? "Imported" : "[dry-run] Would import"}: ` +
            `${imported.length} users / ${credentialRows} credential accounts / ${oauthRows} OAuth links`
    );

    // ── Verification pass ──────────────────────────────────────────────
    const problems: string[] = [];

    const appRows = await db.select({ userId: users.userId, email: users.email }).from(users);
    const importedIds = new Set(imported.map(u => u.id));
    const authUserIds = execute
        ? new Set((await db.select({ id: authUser.id }).from(authUser)).map(r => r.id))
        : importedIds;

    for (const row of appRows) {
        if (!authUserIds.has(row.userId)) {
            problems.push(`app user ${row.userId} (${row.email}) has no auth_user row`);
        }
    }

    if (execute) {
        const credentialed = await db
            .select({ userId: authAccount.userId })
            .from(authAccount)
            .where(sql`${authAccount.providerId} = 'credential'`);
        const credentialedIds = new Set(credentialed.map(r => r.userId));
        for (const user of imported) {
            if (user.passwordDigest && !credentialedIds.has(user.id)) {
                problems.push(`imported user ${user.id} is missing its credential account`);
            }
        }
    }

    const withoutPassword = imported.filter(u => !u.passwordDigest && u.oauth.length === 0);
    if (withoutPassword.length > 0) {
        console.warn(
            `note: ${withoutPassword.length} user(s) have neither a password digest nor an ` +
                `OAuth identity — they will need the "forgot password" flow to get in:\n` +
                withoutPassword.map(u => `  - ${u.id} (${u.email})`).join("\n")
        );
    }

    await client.end();

    if (problems.length > 0) {
        console.error(`VERIFICATION FAILED (${problems.length}):`);
        for (const p of problems) console.error(`  - ${p}`);
        console.error("Do not cut over. Fix the export (or the app rows) and re-run.");
        process.exit(1);
    }
    console.log("Verification passed: every app user maps to an auth_user row.");
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
