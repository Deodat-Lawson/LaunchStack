import type { ObjectRef } from "@launchstack/core/storage";

export type InventoryClassification =
    | "manifested"
    | "referenced_high_confidence"
    | "referenced_legacy"
    | "confirmed_orphan"
    | "unknown";

export interface InventoryAuditObject {
    ref: ObjectRef;
    size?: number;
}

export interface InventoryAuditContext {
    listingAvailable: boolean;
    manifestRefs?: ReadonlySet<string>;
    highConfidenceRefs: ReadonlySet<string>;
    mediumConfidenceRefs: ReadonlySet<string>;
}

export function objectRefKey(ref: ObjectRef): string {
    return `${ref.adapter}\u0000${ref.storageLocationId}\u0000${ref.key}`;
}

export function classifyInventoryObject(
    object: InventoryAuditObject,
    context: InventoryAuditContext
): InventoryClassification {
    if (!context.listingAvailable) return "unknown";

    const key = objectRefKey(object.ref);
    if (context.manifestRefs?.has(key)) return "manifested";
    if (context.highConfidenceRefs.has(key)) return "referenced_high_confidence";
    if (context.mediumConfidenceRefs.has(key)) return "referenced_legacy";
    return "confirmed_orphan";
}
