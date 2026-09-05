/**
 * GET /api/company/metadata
 *
 * Returns the stored company metadata for the logged-in user's company.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "~/server/db";
import { companyMetadata, companyMetadataHistory } from "~/server/db/schema";
import type {
    CompanyMetadataJSON,
    MetadataFact,
    Visibility,
    Usage,
} from "@launchstack/pipelines/company-metadata";
import {
    requireWorkspaceContext,
    requireWorkspacePermission,
} from "~/lib/require-workspace-context";

export async function GET() {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;

        const [result] = await db
            .select({
                metadata: companyMetadata.metadata,
                schemaVersion: companyMetadata.schemaVersion,
                createdAt: companyMetadata.createdAt,
                updatedAt: companyMetadata.updatedAt,
            })
            .from(companyMetadata)
            .where(eq(companyMetadata.companyId, ctx.data.companyId));

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
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

const PatchSchema = z.object({
    path: z.string().min(1),
    value: z.string(),
});

function buildManualFact(
    value: string | number,
    existing?: { visibility?: string; usage?: string }
): MetadataFact<string | number> {
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

type EditOutcome =
    | { ok: true; oldFact?: MetadataFact<unknown>; updatedFact: MetadataFact<string | number> }
    | { ok: false; error: string };

/**
 * Applies one manual edit to an already-cloned metadata document, in place.
 *
 * Kept separate from the IO so it can run inside the row lock without holding
 * the lock open across anything slow.
 */
function applyManualEdit(metadata: CompanyMetadataJSON, path: string, value: string): EditOutcome {
    const segments = path.split(".");
    let oldFact: MetadataFact<unknown> | undefined;
    let updatedFact: MetadataFact<string | number>;

    if (segments[0] === "company" && segments[1]) {
        const field = segments[1];
        oldFact = metadata.company[field];
        updatedFact = buildManualFact(field === "founded_year" ? Number(value) : value, oldFact);
        metadata.company[field] = updatedFact;
    } else if (segments[0] === "people" && segments[1] && segments[2]) {
        const idx = Number(segments[1]);
        const field = segments[2];
        if (isNaN(idx) || idx < 0 || idx >= metadata.people.length) {
            return { ok: false, error: "Invalid people index" };
        }
        const person = metadata.people[idx]!;
        oldFact = person[field];
        updatedFact = buildManualFact(value, oldFact);
        person[field] = updatedFact;
    } else if (segments[0] === "services" && segments[1] && segments[2]) {
        const idx = Number(segments[1]);
        const field = segments[2];
        if (isNaN(idx) || idx < 0 || idx >= metadata.services.length) {
            return { ok: false, error: "Invalid services index" };
        }
        const service = metadata.services[idx]!;
        oldFact = service[field];
        updatedFact = buildManualFact(value, oldFact);
        service[field] = updatedFact;
    } else if (segments[0] === "markets" && segments[1] && segments[2] != null) {
        const subfield = segments[1] as "primary" | "verticals" | "geographies";
        const idx = Number(segments[2]);
        const arr = metadata.markets[subfield];
        if (!arr || isNaN(idx) || idx < 0 || idx >= arr.length) {
            return { ok: false, error: "Invalid markets index" };
        }
        oldFact = arr[idx];
        updatedFact = buildManualFact(value, oldFact);
        arr[idx] = updatedFact as MetadataFact<string>;
    } else if (segments[0] === "legal" && segments[1] && segments[2]) {
        // Contract dates, parties and status are the facts a human is most
        // likely to need to correct, so they have to be reachable here.
        const idx = Number(segments[1]);
        const field = segments[2];
        if (isNaN(idx) || idx < 0 || idx >= metadata.legal.length) {
            return { ok: false, error: "Invalid legal index" };
        }
        const entry = metadata.legal[idx]!;
        oldFact = entry[field];
        updatedFact = buildManualFact(value, oldFact);
        entry[field] = updatedFact;
    } else if (segments[0] === "policies" && segments[1]) {
        const key = segments[1];
        oldFact = metadata.policies[key];
        updatedFact = buildManualFact(value, oldFact);
        metadata.policies[key] = updatedFact as MetadataFact<string>;
    } else {
        return { ok: false, error: `Unsupported path: ${path}` };
    }

    metadata.updated_at = new Date().toISOString();
    return { ok: true, oldFact, updatedFact };
}

export async function PATCH(request: Request) {
    try {
        // Canonical metadata and its history are workspace-wide state.
        const ctx = await requireWorkspacePermission("settings.manage");
        if (!ctx.success) return ctx.response;

        const body = (await request.json()) as unknown;
        const parsed = PatchSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
        }
        const { path, value } = parsed.data;
        const companyId = ctx.data.companyId;

        // Read-modify-write of a whole JSONB blob races the worker's projection,
        // which reads this same row, spends seconds in an LLM call, then writes
        // the blob back. Without the row lock a manual override lands inside
        // that window and is silently overwritten — the one thing a
        // manual_override is supposed to survive.
        const outcome = await db.transaction(async tx => {
            const [existing] = await tx
                .select({ metadata: companyMetadata.metadata })
                .from(companyMetadata)
                .where(eq(companyMetadata.companyId, companyId))
                .for("update");

            if (!existing) return { kind: "missing" as const };

            const updatedMetadata = structuredClone(existing.metadata);
            const edit = applyManualEdit(updatedMetadata, path, value);
            if (!edit.ok) return { kind: "bad-path" as const, error: edit.error };

            const diff = {
                added: edit.oldFact ? [] : [{ path, new: edit.updatedFact }],
                updated: edit.oldFact ? [{ path, old: edit.oldFact, new: edit.updatedFact }] : [],
                deprecated: [],
            };

            await tx
                .update(companyMetadata)
                .set({ metadata: updatedMetadata })
                .where(eq(companyMetadata.companyId, companyId));

            await tx.insert(companyMetadataHistory).values({
                companyId,
                changeType: "manual_override",
                diff,
                changedBy: ctx.data.authUserId,
            });

            return { kind: "ok" as const, fact: edit.updatedFact };
        });

        if (outcome.kind === "missing") {
            return NextResponse.json(
                { error: "No metadata found. Run extraction first." },
                { status: 404 }
            );
        }
        if (outcome.kind === "bad-path") {
            return NextResponse.json({ error: outcome.error }, { status: 400 });
        }

        return NextResponse.json({ success: true, path, fact: outcome.fact });
    } catch (error) {
        console.error("[company-metadata] PATCH error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
