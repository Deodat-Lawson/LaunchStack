/**
 * The `users` row for a signed-in person, created on first join. The legacy
 * `role` / `status` columns are never named here — they have defaults and
 * nothing reads them; the membership row is the only source of truth.
 */

import { eq } from "drizzle-orm";

import { users } from "~/server/db/schema";

import type { Executor } from "./db-types";
import type { SessionUser } from "./session";

export async function ensureUserRow(
    tx: Executor,
    user: SessionUser,
    opts: { name?: string | null; companyId: bigint }
): Promise<bigint> {
    const [existing] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.userId, user.authUserId))
        .limit(1);
    if (existing) return BigInt(existing.id);

    let name = user.name ?? user.email;
    const requested = opts.name?.trim();
    if (requested) name = requested;
    const [inserted] = await tx
        .insert(users)
        .values({
            userId: user.authUserId,
            name,
            email: user.email,
            companyId: opts.companyId,
        })
        .returning({ id: users.id });
    if (!inserted) throw new Error("users insert returned no row");
    return BigInt(inserted.id);
}
