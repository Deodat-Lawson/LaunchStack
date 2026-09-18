/**
 * Fixed development accounts.
 *
 * A local stack is only useful if you can log into it, and signing up by hand
 * after every `down`/`up` is the kind of friction that stops people testing.
 * This creates one workspace with one account per built-in role, so the roles
 * and folder-access rules can actually be exercised rather than just read.
 *
 *   pnpm --filter @launchstack/web db:seed
 *   docker compose --profile seed run --rm seed        # against the stack
 *
 * Safe to re-run: every step is find-or-create, so a second run reports what
 * already exists and writes nothing.
 *
 * Three things keep this away from real data:
 *
 * - `DEV_SEED_PASSWORD` has no default. Without it the script refuses, so it
 *   cannot run by accident and no credential is committed to this repository.
 * - The Compose service is behind `profiles: ["seed"]`, so `up` never starts
 *   it — the same treatment `backfill` gets, for the same reason.
 * - It prints the database host it is about to write to before it writes.
 *
 * None of that makes it safe to point at production. It is a development
 * convenience and nothing more.
 */

import "dotenv/config";

import { and, eq } from "drizzle-orm";

import { company } from "@launchstack/store/schema";

import { auth } from "../src/server/auth";
import { db } from "../src/server/db";
import { users, userCompanyMemberships } from "../src/server/db/schema";
import { authUser } from "../src/server/db/schema/auth";
import { ensureTokenAccount } from "../src/lib/credits/service";
import { generateUniqueSlug } from "../src/lib/workspace-slug";

/**
 * One account per built-in role. `owner` is first because it is the account
 * that creates the workspace; the rest are attached to it afterwards.
 *
 * The emails use `.test`, which RFC 6761 reserves for exactly this — it can
 * never resolve, so a stray password-reset mail has nowhere to go.
 */
const ACCOUNTS = [
    { email: "owner@launchstack.test", name: "Dev Owner", role: "owner" },
    { email: "admin@launchstack.test", name: "Dev Admin", role: "admin" },
    { email: "member@launchstack.test", name: "Dev Member", role: "member" },
    { email: "viewer@launchstack.test", name: "Dev Viewer", role: "viewer" },
] as const;

function requireSeedPassword(): string {
    const password = process.env.DEV_SEED_PASSWORD?.trim();
    if (!password) {
        console.error(
            "DEV_SEED_PASSWORD is not set.\n\n" +
                "This script has no default password on purpose: a literal here would be a\n" +
                "real credential in the repository, and an implicit default would let the\n" +
                "script run somewhere nobody intended. Set it in .env, then re-run.\n"
        );
        process.exit(1);
    }
    // Better Auth's own minimum. Failing here beats four identical failures later.
    if (password.length < 8) {
        console.error("DEV_SEED_PASSWORD must be at least 8 characters.");
        process.exit(1);
    }
    return password;
}

/** Host and database only — never the credentials in the URL. */
function describeTarget(): string {
    const raw = process.env.DATABASE_URL;
    if (!raw) return "(DATABASE_URL unset)";
    try {
        const url = new URL(raw);
        return `${url.hostname}:${url.port || "5432"}${url.pathname}`;
    } catch {
        return "(unparseable DATABASE_URL)";
    }
}

/**
 * The Better Auth identity for one account, created if absent.
 *
 * Going through `auth.api.signUpEmail` rather than writing the row directly is
 * what gets the password hashed the way the sign-in path expects — the hashing
 * is configured in src/server/auth, and a second implementation here would be
 * one refactor away from producing accounts nobody can log into.
 */
async function ensureAuthUser(
    account: (typeof ACCOUNTS)[number],
    password: string
): Promise<{ id: string; created: boolean }> {
    const [existing] = await db
        .select({ id: authUser.id })
        .from(authUser)
        .where(eq(authUser.email, account.email))
        .limit(1);
    if (existing) return { id: existing.id, created: false };

    await auth.api.signUpEmail({
        body: { name: account.name, email: account.email, password },
    });

    const [created] = await db
        .select({ id: authUser.id })
        .from(authUser)
        .where(eq(authUser.email, account.email))
        .limit(1);
    if (!created) throw new Error(`sign-up reported success but no row for ${account.email}`);
    return { id: created.id, created: true };
}

/** The workspace, created if absent. Named rather than generated so re-runs find it. */
async function ensureCompany(name: string): Promise<{ id: bigint; created: boolean }> {
    const [existing] = await db.select({ id: company.id }).from(company).where(eq(company.name, name));
    if (existing) return { id: BigInt(existing.id), created: false };

    const [inserted] = await db
        .insert(company)
        .values({ name, slug: await generateUniqueSlug(name), numberOfEmployees: "1" })
        .returning({ id: company.id });
    if (!inserted) throw new Error("company insert returned no row");
    return { id: BigInt(inserted.id), created: true };
}

/**
 * The `users` row plus the membership carrying the role.
 *
 * The membership is the only source of truth for what someone may do — the
 * legacy `role`/`status` columns on `users` are left at their defaults, the
 * same choice server/workspace/user-row.ts documents.
 */
async function ensureMembership(
    authUserId: string,
    account: (typeof ACCOUNTS)[number],
    companyId: bigint
): Promise<"created" | "existing" | "role-updated"> {
    let [userRow] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.userId, authUserId))
        .limit(1);

    if (!userRow) {
        [userRow] = await db
            .insert(users)
            .values({ userId: authUserId, companyId, name: account.name, email: account.email })
            .returning({ id: users.id });
    }
    if (!userRow) throw new Error(`users insert returned no row for ${account.email}`);
    const userPk = BigInt(userRow.id);

    const [membership] = await db
        .select({ id: userCompanyMemberships.id, role: userCompanyMemberships.role })
        .from(userCompanyMemberships)
        .where(
            and(
                eq(userCompanyMemberships.userId, userPk),
                eq(userCompanyMemberships.companyId, companyId)
            )
        )
        .limit(1);

    if (membership) {
        // A re-run after someone edited the role in the UI should restore the
        // documented set, otherwise "seeded" stops meaning anything.
        if (membership.role === account.role) return "existing";
        await db
            .update(userCompanyMemberships)
            .set({ role: account.role, status: "active" })
            .where(eq(userCompanyMemberships.id, membership.id));
        return "role-updated";
    }

    await db.insert(userCompanyMemberships).values({
        userId: userPk,
        companyId,
        role: account.role,
        status: "active",
    });
    return "created";
}

async function main() {
    const password = requireSeedPassword();
    // `??` would keep an empty string; a blank override should mean "default".
    const configured = process.env.DEV_SEED_WORKSPACE?.trim() ?? "";
    const workspace = configured.length > 0 ? configured : "LaunchStack Dev";

    console.log(`Seeding "${workspace}" into ${describeTarget()}\n`);

    const { id: companyId, created: companyCreated } = await ensureCompany(workspace);
    console.log(`workspace  ${workspace} — ${companyCreated ? "created" : "already present"}`);

    for (const account of ACCOUNTS) {
        const { id: authUserId, created } = await ensureAuthUser(account, password);
        const membership = await ensureMembership(authUserId, account, companyId);
        const notes = [created ? "account created" : "account exists", membership].join(", ");
        console.log(`${account.role.padEnd(7)}    ${account.email.padEnd(28)} ${notes}`);
    }

    await ensureTokenAccount(companyId);

    console.log(
        `\nDone. Sign in at /sign-in with any address above and the value of ` +
            `DEV_SEED_PASSWORD.\nRe-running this script is safe.`
    );
}

main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
        console.error("\nSeed failed:", error instanceof Error ? error.message : error);
        if (error instanceof Error && error.stack) console.error(error.stack);
        process.exit(1);
    });
