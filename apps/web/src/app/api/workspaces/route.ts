import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq, desc, count } from "drizzle-orm";
import { z } from "zod";

import { db } from "~/server/db";
import {
    users,
    company,
    userCompanyMemberships,
} from "@launchstack/core/db/schema";
import { initTokenAccount, TOKEN_SIGNUP_BONUS } from "~/lib/credits";
import {
    setActiveWorkspaceCookie,
    getActiveCompanyId,
} from "~/lib/active-workspace";

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

const CreateWorkspaceSchema = z.object({
    name: z.string().trim().min(1).max(120),
    slug: z
        .string()
        .trim()
        .toLowerCase()
        .min(2)
        .max(64)
        .regex(SLUG_RE, "Slug must be lowercase letters, numbers, or dashes."),
    swatch: z.number().int().min(1).max(6).default(1),
    teamSize: z.string().max(64).optional(),
    description: z.string().max(2000).optional(),
});

export async function GET() {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const [user] = await db
            .select({ id: users.id, defaultCompanyId: users.companyId })
            .from(users)
            .where(eq(users.userId, userId));

        if (!user) {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }

        const memberCountSubquery = db
            .select({
                companyId: userCompanyMemberships.companyId,
                memberCount: count(userCompanyMemberships.id).as("member_count"),
            })
            .from(userCompanyMemberships)
            .groupBy(userCompanyMemberships.companyId)
            .as("mc");

        const rows = await db
            .select({
                id: company.id,
                name: company.name,
                slug: company.slug,
                description: company.description,
                swatch: company.swatch,
                role: userCompanyMemberships.role,
                lastOpenedAt: userCompanyMemberships.lastOpenedAt,
                memberCount: memberCountSubquery.memberCount,
            })
            .from(userCompanyMemberships)
            .innerJoin(company, eq(company.id, userCompanyMemberships.companyId))
            .leftJoin(
                memberCountSubquery,
                eq(memberCountSubquery.companyId, userCompanyMemberships.companyId)
            )
            .where(eq(userCompanyMemberships.userId, BigInt(user.id)))
            .orderBy(desc(userCompanyMemberships.lastOpenedAt));

        const activeCompanyId = await getActiveCompanyId(userId);

        return NextResponse.json({
            activeCompanyId: activeCompanyId.toString(),
            workspaces: rows.map((r) => ({
                id: r.id,
                name: r.name,
                slug: r.slug,
                description: r.description,
                swatch: r.swatch ?? 1,
                role: r.role,
                memberCount: Number(r.memberCount ?? 1),
                lastOpenedAt: r.lastOpenedAt,
                isActive: BigInt(r.id) === activeCompanyId,
            })),
        });
    } catch (err) {
        console.error("[workspaces] GET error:", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const json = await request.json().catch(() => ({}));
        const parsed = CreateWorkspaceSchema.safeParse(json);
        if (!parsed.success) {
            return NextResponse.json(
                { error: "Invalid input", issues: parsed.error.flatten() },
                { status: 400 }
            );
        }
        const { name, slug, swatch, teamSize, description } = parsed.data;

        const [existingSlug] = await db
            .select({ id: company.id })
            .from(company)
            .where(eq(company.slug, slug));
        if (existingSlug) {
            return NextResponse.json(
                { error: "Slug already taken" },
                { status: 409 }
            );
        }

        const [user] = await db
            .select({ id: users.id, name: users.name, email: users.email })
            .from(users)
            .where(eq(users.userId, userId));
        if (!user) {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }

        const teamSizeForCompany = teamSize?.trim() || "1";

        const [newCompany] = await db
            .insert(company)
            .values({
                name,
                slug,
                swatch,
                description: description ?? null,
                numberOfEmployees: teamSizeForCompany,
            })
            .returning({ id: company.id });

        if (!newCompany) {
            return NextResponse.json(
                { error: "Could not create workspace" },
                { status: 500 }
            );
        }

        const newCompanyId = BigInt(newCompany.id);

        await db.insert(userCompanyMemberships).values({
            userId: BigInt(user.id),
            companyId: newCompanyId,
            role: "owner",
        });

        try {
            await initTokenAccount(newCompanyId, TOKEN_SIGNUP_BONUS);
        } catch (creditErr) {
            console.error("[workspaces] initTokenAccount failed:", creditErr);
            // Non-fatal: workspace exists, credits can be initialized later.
        }

        const response = NextResponse.json({
            success: true,
            workspace: {
                id: newCompany.id,
                name,
                slug,
                swatch,
                role: "owner",
            },
        });
        setActiveWorkspaceCookie(response, newCompanyId);
        return response;
    } catch (err) {
        console.error("[workspaces] POST error:", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
