/**
 * Drive-linked files reconciler (Leg 3's cron half).
 *
 * Every 15 minutes, sweep linked documents oldest-checked first and pull
 * settled Drive revisions back as versions. Each link costs one metadata GET
 * per tick; a download happens only when a settled revision actually moved.
 * A tick that dies mid-run redoes safely — version creation is idempotent by
 * creation key. When the feature flag is off, `pullDueLinks` returns
 * immediately and the tick is a no-op.
 */
import { inngest } from "../client";
import { pullDueLinks } from "~/server/services/google-drive/sync";

const RECONCILE_BATCH_LIMIT = 100;

export const googleDriveSyncReconciler = inngest.createFunction(
    { id: "google-drive-sync-reconciler", retries: 1 },
    { cron: "*/15 * * * *" },
    async ({ step }) => {
        const result = await step.run("pull-due-links", () =>
            pullDueLinks({ limit: RECONCILE_BATCH_LIMIT })
        );

        if (result.checked > 0) {
            console.log(
                `[google-drive] reconciler: checked=${result.checked} synced=${result.synced} ` +
                    `settling=${result.settling} orphaned=${result.orphaned} ` +
                    `errors=${result.errors} stale=${result.stale}`
            );
        }
        return result;
    }
);
