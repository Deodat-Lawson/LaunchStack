import "server-only";

/**
 * Tells a reporter that the team answered or moved their report — a row in
 * the workspace inbox (`workspace_notifications`, the bell), written in the
 * transaction that made the change.
 *
 * The inbox is per workspace, so a report filed with no active workspace (the
 * workspace picker), or whose workspace has since been deleted, notifies
 * nobody; the reporter still sees the change in the Feedback tab. Nobody is
 * told about their own change.
 */

import {
    FEEDBACK_NOTIFICATION_KIND,
    FEEDBACK_NOTIFICATION_TARGET,
    type FeedbackNotificationDetail,
} from "~/lib/feedback/contract";
import { workspaceNotifications } from "~/server/db/schema";
import type { Executor } from "~/server/workspace/db-types";

export interface NotifyReporterInput {
    report: {
        id: number;
        title: string;
        reporterUserId: string;
        companyId: bigint | null;
    };
    /** Auth subject id of the triager who acted. */
    actorUserId: string;
    detail: FeedbackNotificationDetail;
}

/** Whether a row was written. */
export async function notifyReporter(
    executor: Executor,
    input: NotifyReporterInput
): Promise<boolean> {
    const { report } = input;
    if (report.companyId === null) return false;
    if (report.reporterUserId === input.actorUserId) return false;
    await executor.insert(workspaceNotifications).values({
        companyId: report.companyId,
        recipientUserId: report.reporterUserId,
        actorUserId: input.actorUserId,
        kind: FEEDBACK_NOTIFICATION_KIND,
        targetType: FEEDBACK_NOTIFICATION_TARGET,
        targetId: String(report.id),
        targetLabel: report.title.slice(0, 300),
        detail: { ...input.detail },
    });
    return true;
}
