// PATCH /api/distribution/relationships/[id] — stage, owner, next action, note
//
// Stage moves go through the transition table (409 on an illegal move or a
// missing required field). Every change writes a timeline event.
import type { NextRequest } from "next/server";

import { RelationshipPatchSchema } from "@launchstack/pipelines/distribution/types";
import {
    addEvent,
    getRelationship,
    transitionStage,
    updateRelationship,
} from "@launchstack/pipelines/distribution/db";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { error, handleRouteError, json, readJsonBody } from "~/server/distribution/http";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const ctx = await requireWorkspaceContext();
        if (!ctx.success) return ctx.response;
        const { id } = await params;
        const parsed = RelationshipPatchSchema.safeParse(await readJsonBody(request));
        if (!parsed.success)
            return error("Validation failed", 400, { details: parsed.error.flatten() });
        const patch = parsed.data;
        const companyId = ctx.data.companyId;
        const actor = ctx.data.authUserId;

        let relationship = await getRelationship(id, companyId);
        if (!relationship) return error("Not found", 404);

        const nextActionAt =
            patch.nextActionAt === undefined
                ? undefined
                : patch.nextActionAt === null
                  ? null
                  : new Date(patch.nextActionAt);

        if (patch.stage && patch.stage !== relationship.stage) {
            relationship = await transitionStage({
                companyId,
                relationshipId: id,
                to: patch.stage,
                actorUserId: actor,
                ownerUserId: patch.ownerUserId,
                nextAction: patch.nextAction,
                nextActionAt,
            });
        } else {
            const fields: Parameters<typeof updateRelationship>[2] = {};
            if (patch.ownerUserId !== undefined) fields.ownerUserId = patch.ownerUserId;
            if (patch.nextAction !== undefined) fields.nextAction = patch.nextAction;
            if (nextActionAt !== undefined) fields.nextActionAt = nextActionAt;
            if (Object.keys(fields).length > 0) {
                const updated = await updateRelationship(id, companyId, fields);
                if (!updated) return error("Not found", 404);
                relationship = updated;
                if (patch.ownerUserId !== undefined && patch.ownerUserId !== null) {
                    await addEvent({
                        companyId,
                        relationshipId: id,
                        type: "owner_changed",
                        payload: { ownerUserId: patch.ownerUserId },
                        actorUserId: actor,
                        touch: false,
                    });
                }
                if (patch.nextAction !== undefined || nextActionAt !== undefined) {
                    await addEvent({
                        companyId,
                        relationshipId: id,
                        type: "next_action_set",
                        payload: {
                            nextAction: patch.nextAction ?? relationship.nextAction,
                            nextActionAt: relationship.nextActionAt,
                        },
                        actorUserId: actor,
                        touch: false,
                    });
                }
            }
        }
        if (patch.note) {
            await addEvent({
                companyId,
                relationshipId: id,
                type: "note",
                payload: { text: patch.note },
                actorUserId: actor,
            });
            relationship = (await getRelationship(id, companyId)) ?? relationship;
        }
        return json({ relationship });
    } catch (err) {
        return handleRouteError("PATCH relationship", err);
    }
}
