/**
 * Which Microsoft 365 connection the workspace's panels manage: the active
 * one, or the most recent when none is active, so a revoked connection
 * still shows up as something to reconnect (its picks are kept on it).
 */

import type { ConnectorConnection } from "~/server/db/schema";
import { MICROSOFT_365_PROVIDER } from "~/server/services/microsoft/config";

import { listConnectionsForCompany } from "../connection-store";

export async function primaryMicrosoft365Connection(
    companyId: bigint
): Promise<ConnectorConnection | null> {
    const rows = await listConnectionsForCompany(companyId, MICROSOFT_365_PROVIDER);
    if (rows.length === 0) return null;
    const active = rows.find(row => row.status === "active");
    if (active) return active;
    const touched = (row: ConnectorConnection) => (row.updatedAt ?? row.createdAt).getTime();
    return [...rows].sort((a, b) => touched(b) - touched(a))[0] ?? null;
}
