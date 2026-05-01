import { auth } from "@clerk/nextjs/server";
import { eq, count } from "drizzle-orm";

import { db } from "~/server/db";
import {
  company,
  userCompanyMemberships,
  users,
} from "@launchstack/core/db/schema";
import { getActiveCompanyId } from "~/lib/active-workspace";

import type { WorkspaceSwitcherPayload } from "./workspaceSwitcherTypes";

export async function getWorkspaceSwitcherPayload(): Promise<WorkspaceSwitcherPayload | null> {
  const { userId } = await auth();
  if (!userId) return null;

  let activeCompanyId: bigint;
  try {
    activeCompanyId = await getActiveCompanyId(userId);
  } catch {
    return null;
  }

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.userId, userId));
  if (!user) return null;

  const [activeCompany] = await db
    .select({
      name: company.name,
      swatch: company.swatch,
    })
    .from(company)
    .where(eq(company.id, Number(activeCompanyId)));

  const [{ c: membershipCount } = { c: 0 }] = await db
    .select({ c: count(userCompanyMemberships.id) })
    .from(userCompanyMemberships)
    .where(eq(userCompanyMemberships.userId, BigInt(user.id)));

  if (!activeCompany) return null;

  const initials = activeCompany.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join("");

  return {
    name: activeCompany.name,
    initials: initials || "✶",
    swatch: activeCompany.swatch ?? null,
    membershipCount: Number(membershipCount),
  };
}
