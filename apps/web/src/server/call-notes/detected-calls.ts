import { and, desc, eq, inArray } from "drizzle-orm";

import type { DbClient } from "@launchstack/core/db";
import {
    CALL_NOTES_SCHEMA_VERSION,
    DetectedCallCandidateSchema,
    callNotesWorkItems,
    callNotesZoomConnections,
    type CallListQuery,
    type DetectedCallCandidate,
    type DetectedCallSource,
} from "@launchstack/features/call-notes";

import { getEngine } from "~/server/engine";

export class ZoomDetectedCallSource implements DetectedCallSource {
    constructor(private readonly db: DbClient = getEngine().db) {}

    async list(query: CallListQuery): Promise<readonly DetectedCallCandidate[]> {
        const companyId = BigInt(query.companyId);
        const [connection] = await this.db
            .select({ zoomUserId: callNotesZoomConnections.zoomUserId })
            .from(callNotesZoomConnections)
            .where(
                and(
                    eq(callNotesZoomConnections.companyId, companyId),
                    eq(callNotesZoomConnections.userId, query.actorUserId),
                    eq(callNotesZoomConnections.status, "active")
                )
            )
            .limit(1);
        if (!connection) return [];

        const rows = await this.db
            .select({
                payload: callNotesWorkItems.payload,
                createdAt: callNotesWorkItems.createdAt,
            })
            .from(callNotesWorkItems)
            .where(
                and(
                    eq(callNotesWorkItems.companyId, companyId),
                    eq(callNotesWorkItems.kind, "provider_event"),
                    inArray(callNotesWorkItems.status, ["pending", "claimed"])
                )
            )
            .orderBy(desc(callNotesWorkItems.createdAt))
            .limit(Math.min(query.limit * 4, 100));

        const seen = new Set<string>();
        const candidates: DetectedCallCandidate[] = [];
        for (const row of rows) {
            const payload = row.payload;
            if (payload.source !== "zoom_webhook" || payload.event !== "meeting.rtms_started")
                continue;
            const zoomPayload = payload.payload;
            if (!zoomPayload || typeof zoomPayload !== "object" || Array.isArray(zoomPayload))
                continue;
            const values = zoomPayload as Record<string, unknown>;
            if (
                typeof values.meeting_uuid !== "string" ||
                (typeof values.operator_id === "string" &&
                    values.operator_id !== connection.zoomUserId)
            ) {
                continue;
            }
            if (seen.has(values.meeting_uuid)) continue;
            seen.add(values.meeting_uuid);
            candidates.push(
                DetectedCallCandidateSchema.parse({
                    schemaVersion: CALL_NOTES_SCHEMA_VERSION,
                    provider: "zoom",
                    occurrenceKey: values.meeting_uuid,
                    title:
                        typeof values.topic === "string" && values.topic
                            ? values.topic
                            : "Zoom meeting",
                    detectedAt: row.createdAt.toISOString(),
                    endsAt: null,
                })
            );
            if (candidates.length >= query.limit) break;
        }
        return candidates;
    }
}
