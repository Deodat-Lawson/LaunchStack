/**
 * Storage deletion admin/repair tools — B3 checklist item 9.
 *
 * "Audited BLOCKED -> STORAGE_DELETING (repair/requeue) and BLOCKED ->
 * QUARANTINED (approved exception) transitions — logged with actor, not
 * reachable from the public delete API."
 *
 * Deliberately not wired to any HTTP route (no B4/B5 endpoint calls these).
 * A future admin UI/route would call these directly; until that exists,
 * they're only reachable from a script or a future admin tool, same as
 * this file's own manual test script.
 */

import { eq } from "drizzle-orm";
import { storageDeletionItems, storageObjects } from "@launchstack/core/db/schema";

import { db } from "~/server/db";

export class AdminActionRefusedError extends Error {}

function logAudit(action: string, itemId: number, actorId: string, extra?: string) {
  console.log(
    `[storage-deletion-admin] action=${action} item=${itemId} actor=${actorId} at=${new Date().toISOString()}${extra ? ` ${extra}` : ""}`,
  );
}

/**
 * Repair path: a BLOCKED item gets requeued for another attempt. Resets
 * its attempt counter (this is a deliberate, human-approved retry, not a
 * continuation of the automatic budget) and flips its storage_objects row
 * back to STORAGE_DELETING so the worker picks it up again as "already in
 * progress" rather than "not started" (CANCELLED stays out of reach here —
 * only cancelDeletionRequest, in the coordinator, can set that).
 */
export async function requeueBlockedDeletionItem(
  itemId: number,
  actorId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(storageDeletionItems)
      .where(eq(storageDeletionItems.id, itemId))
      .for("update");

    if (!item) {
      throw new Error(`requeueBlockedDeletionItem: item ${itemId} not found`);
    }
    if (item.itemState !== "BLOCKED") {
      throw new AdminActionRefusedError(
        `requeueBlockedDeletionItem: item ${itemId} is "${item.itemState}", not BLOCKED — refusing`,
      );
    }

    await tx
      .update(storageDeletionItems)
      .set({ itemState: "WAITING_RETRY", attempts: 0, lastError: null })
      .where(eq(storageDeletionItems.id, itemId));

    if (item.objectId !== null) {
      await tx
        .update(storageObjects)
        .set({ lifecycleState: "STORAGE_DELETING" })
        .where(eq(storageObjects.id, Number(item.objectId)));
    }
  });

  logAudit("requeue", itemId, actorId);
}

/**
 * Approved-exception path: a BLOCKED item is given up on deliberately (an
 * admin decided this file should not, or cannot, actually be deleted).
 * Per Decision 2/10, QUARANTINED items are never reported as a physical
 * delete — they permanently block the request from reaching "completed".
 */
export async function quarantineBlockedDeletionItem(
  itemId: number,
  actorId: string,
  reason: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(storageDeletionItems)
      .where(eq(storageDeletionItems.id, itemId))
      .for("update");

    if (!item) {
      throw new Error(`quarantineBlockedDeletionItem: item ${itemId} not found`);
    }
    if (item.itemState !== "BLOCKED") {
      throw new AdminActionRefusedError(
        `quarantineBlockedDeletionItem: item ${itemId} is "${item.itemState}", not BLOCKED — refusing`,
      );
    }

    await tx
      .update(storageDeletionItems)
      .set({ itemState: "QUARANTINED", lastError: reason })
      .where(eq(storageDeletionItems.id, itemId));

    if (item.objectId !== null) {
      await tx
        .update(storageObjects)
        .set({ lifecycleState: "QUARANTINED" })
        .where(eq(storageObjects.id, Number(item.objectId)));
    }
  });

  logAudit("quarantine", itemId, actorId, `reason="${reason}"`);
}
