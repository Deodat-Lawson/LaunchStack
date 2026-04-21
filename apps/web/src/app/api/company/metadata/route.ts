/**
 * GET /api/company/metadata
 *
 * Returns the stored company metadata for the logged-in user's company.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "~/server/db";
import { users } from "@launchstack/core/db/schema";
import { companyMetadata, companyMetadataHistory } from "@launchstack/core/db/schema/company-metadata";
import type { MetadataFact, Visibility, Usage } from "@launchstack/features/company-metadata";

export async function GET() {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }

        const [userInfo] = await db
            .select({ companyId: users.companyId })
            .from(users)
            .where(eq(users.userId, userId));

        if (!userInfo) {
            return NextResponse.json(
                { error: "User not found" },
                { status: 400 },
            );
        }

        const [result] = await db
            .select({
                metadata: companyMetadata.metadata,
                schemaVersion: companyMetadata.schemaVersion,
                createdAt: companyMetadata.createdAt,
                updatedAt: companyMetadata.updatedAt,
            })
            .from(companyMetadata)
            .where(eq(companyMetadata.companyId, userInfo.companyId));

        if (!result) {
            return NextResponse.json({
                metadata: null,
                message: "No metadata found. Upload documents and run extraction first.",
            });
        }

        return NextResponse.json({
            metadata: result.metadata,
            schemaVersion: result.schemaVersion,
            createdAt: result.createdAt,
            updatedAt: result.updatedAt,
        });
    } catch (error) {
        console.error("[company-metadata] GET error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 },
        );
    }
}

const PatchSchema = z.object({
    path: z.string().min(1),
    value: z.string(),
});

function buildManualFact(value: string | number, existing?: { visibility?: string; usage?: string }): MetadataFact<string | number> {
    const now = new Date().toISOString();
    return {
        value,
        visibility: (existing?.visibility as Visibility | undefined) ?? "public",
        usage: (existing?.usage as Usage | undefined) ?? "outreach_ok",
        confidence: 1.0,
        priority: "manual_override",
        status: "active",
        last_updated: now,
        sources: [{ doc_id: 0, doc_name: "Manual edit", extracted_at: now }],
    };
}

export async function PATCH(request: Request) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json() as unknown;
        const parsed = PatchSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
        }
        const { path, value } = parsed.data;

        const [userInfo] = await db
            .select({ companyId: users.companyId })
            .from(users)
            .where(eq(users.userId, userId));

        if (!userInfo) {
            return NextResponse.json({ error: "User not found" }, { status: 400 });
        }

        const [existing] = await db
            .select({ metadata: companyMetadata.metadata })
            .from(companyMetadata)
            .where(eq(companyMetadata.companyId, userInfo.companyId));

        if (!existing) {
            return NextResponse.json(
                { error: "No metadata found. Run extraction first." },
                { status: 404 },
            );
        }

        const updatedMetadata = structuredClone(existing.metadata);
        const now = new Date().toISOString();
        const segments = path.split(".");
        let oldFact: MetadataFact<unknown> | undefined = undefined;
        let updatedFact: MetadataFact<string | number> | undefined = undefined;

        if (segments[0] === "company" && segments[1]) {
            const field = segments[1];
            const existingFact = updatedMetadata.company[field];
            oldFact = existingFact;
            updatedFact = buildManualFact(
                field === "founded_year" ? Number(value) : value,
                existingFact,
            );
            updatedMetadata.company[field] = updatedFact;
        } else if (segments[0] === "people" && segments[1] && segments[2]) {
            const idx = Number(segments[1]);
            const field = segments[2];
            if (isNaN(idx) || idx < 0 || idx >= updatedMetadata.people.length) {
                return NextResponse.json({ error: "Invalid people index" }, { status: 400 });
            }
            const person = updatedMetadata.people[idx]!;
            oldFact = person[field];
            updatedFact = buildManualFact(value, person[field]);
            person[field] = updatedFact;
        } else if (segments[0] === "services" && segments[1] && segments[2]) {
            const idx = Number(segments[1]);
            const field = segments[2];
            if (isNaN(idx) || idx < 0 || idx >= updatedMetadata.services.length) {
                return NextResponse.json({ error: "Invalid services index" }, { status: 400 });
            }
            const service = updatedMetadata.services[idx]!;
            oldFact = service[field];
            updatedFact = buildManualFact(value, service[field]);
            service[field] = updatedFact;
        } else if (segments[0] === "markets" && segments[1] && segments[2] != null) {
            const subfield = segments[1] as "primary" | "verticals" | "geographies";
            const idx = Number(segments[2]);
            const arr = updatedMetadata.markets[subfield];
            if (!arr || isNaN(idx) || idx < 0 || idx >= arr.length) {
                return NextResponse.json({ error: "Invalid markets index" }, { status: 400 });
            }
            oldFact = arr[idx];
            updatedFact = buildManualFact(value, arr[idx]);
            arr[idx] = updatedFact as MetadataFact<string>;
        } else {
            return NextResponse.json({ error: `Unsupported path: ${path}` }, { status: 400 });
        }

        updatedMetadata.updated_at = now;

        const diff = {
            added: oldFact ? [] : [{ path, new: updatedFact }],
            updated: oldFact ? [{ path, old: oldFact, new: updatedFact }] : [],
            deprecated: [],
        };

        await db
            .update(companyMetadata)
            .set({ metadata: updatedMetadata })
            .where(eq(companyMetadata.companyId, userInfo.companyId));

        await db.insert(companyMetadataHistory).values({
            companyId: userInfo.companyId,
            changeType: "manual_override",
            diff,
            changedBy: userId,
        });

        return NextResponse.json({ success: true, path, fact: updatedFact });
    } catch (error) {
        console.error("[company-metadata] PATCH error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
