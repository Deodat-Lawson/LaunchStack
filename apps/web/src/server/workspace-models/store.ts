/**
 * Reading and writing a workspace's own model endpoint.
 *
 * The decrypted key leaves this module only through
 * {@link readWorkspaceEndpointKey}, for the scope loader and the connection
 * test. Everything the browser sees goes through {@link toEndpointView}, which
 * carries the last four characters and nothing else of the key.
 */

import { eq } from "drizzle-orm";

import { decryptSecret, encryptSecret } from "@launchstack/store/crypto";

import { db } from "~/server/db";
import {
    workspaceModelEndpoints,
    type WorkspaceModelConnection,
    type WorkspaceModelEndpointRow,
    type WorkspaceModelSelection,
} from "~/server/db/schema/workspace-models";
import { users } from "~/server/db/schema/identity";
import { getEngine } from "~/server/engine";
import type { ModelProviderId } from "~/lib/ai/model-providers";

/** What Settings shows. Never the key. */
export interface WorkspaceEndpointView {
    provider: ModelProviderId;
    baseUrl: string;
    hasKey: boolean;
    keyLast4: string | null;
    models: WorkspaceModelSelection | null;
    /** True once a model is chosen — the workspace's work runs here from then on. */
    active: boolean;
    connectedVia: WorkspaceModelConnection;
    updatedAt: string;
    updatedBy: string | null;
}

function toNumericId(companyId: bigint | number | string): number {
    const id = Number(companyId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`Invalid workspace id ${companyId}`);
    return id;
}

export async function getWorkspaceEndpointRow(
    companyId: bigint | number | string
): Promise<WorkspaceModelEndpointRow | null> {
    const [row] = await db
        .select()
        .from(workspaceModelEndpoints)
        .where(eq(workspaceModelEndpoints.companyId, toNumericId(companyId)))
        .limit(1);
    return row ?? null;
}

export function toEndpointView(
    row: WorkspaceModelEndpointRow,
    updatedBy: string | null
): WorkspaceEndpointView {
    return {
        provider: row.provider as ModelProviderId,
        baseUrl: row.baseUrl,
        hasKey: Boolean(row.apiKeyCiphertext),
        keyLast4: row.apiKeyLast4,
        models: row.models ?? null,
        active: Boolean(row.models?.default?.id),
        connectedVia: row.connectedVia,
        updatedAt: row.updatedAt.toISOString(),
        updatedBy,
    };
}

export async function getWorkspaceEndpointView(
    companyId: bigint | number | string
): Promise<WorkspaceEndpointView | null> {
    const row = await getWorkspaceEndpointRow(companyId);
    if (!row) return null;
    let updatedBy: string | null = null;
    if (row.updatedByUserId) {
        const [person] = await db
            .select({ name: users.name })
            .from(users)
            .where(eq(users.id, row.updatedByUserId))
            .limit(1);
        updatedBy = person?.name ?? null;
    }
    return toEndpointView(row, updatedBy);
}

/** The plaintext key, for server-side use only. Never log or return it. */
export function readWorkspaceEndpointKey(row: WorkspaceModelEndpointRow): string | null {
    if (!row.apiKeyCiphertext) return null;
    getEngine(); // registers the secret box key
    return decryptSecret(row.apiKeyCiphertext);
}

function last4(value: string): string | null {
    return value.length >= 8 ? value.slice(-4) : null;
}

export interface SaveWorkspaceEndpointInput {
    companyId: bigint | number | string;
    userId: bigint | number | null;
    provider: ModelProviderId;
    /** Already normalized and checked against the address policy. */
    baseUrl: string;
    /**
     * `undefined` keeps the stored key — allowed only when the address is
     * unchanged, so a stored key never goes to an address it wasn't entered
     * for. `null` saves the endpoint as keyless.
     */
    apiKey: string | null | undefined;
    models: WorkspaceModelSelection | null;
    connectedVia: WorkspaceModelConnection;
}

export class KeyNeededForNewAddressError extends Error {
    constructor() {
        super(
            "The address changed, so enter the API key for the new address. A saved key is only ever sent to the address it was entered for."
        );
        this.name = "KeyNeededForNewAddressError";
    }
}

export async function saveWorkspaceEndpoint(
    input: SaveWorkspaceEndpointInput
): Promise<WorkspaceModelEndpointRow> {
    const companyId = toNumericId(input.companyId);
    const existing = await getWorkspaceEndpointRow(companyId);

    let key: { ciphertext: string | null; last4: string | null; version: number };
    if (input.apiKey === undefined) {
        if (!existing) {
            key = { ciphertext: null, last4: null, version: 1 };
        } else if (existing.baseUrl !== input.baseUrl && existing.apiKeyCiphertext) {
            throw new KeyNeededForNewAddressError();
        } else {
            key = {
                ciphertext: existing.apiKeyCiphertext,
                last4: existing.apiKeyLast4,
                version: existing.encryptionKeyVersion,
            };
        }
    } else if (input.apiKey === null || input.apiKey.trim() === "") {
        key = { ciphertext: null, last4: null, version: 1 };
    } else {
        getEngine(); // registers the secret box key
        const plaintext = input.apiKey.trim();
        const sealed = encryptSecret(plaintext);
        key = {
            ciphertext: sealed.ciphertext,
            last4: last4(plaintext),
            version: sealed.keyVersion,
        };
    }

    const values = {
        provider: input.provider,
        baseUrl: input.baseUrl,
        apiKeyCiphertext: key.ciphertext,
        apiKeyLast4: key.last4,
        encryptionKeyVersion: key.version,
        models: input.models,
        connectedVia: input.connectedVia,
        updatedByUserId: input.userId === null ? null : Number(input.userId),
        updatedAt: new Date(),
    };

    const [row] = await db
        .insert(workspaceModelEndpoints)
        .values({ companyId, ...values })
        .onConflictDoUpdate({ target: workspaceModelEndpoints.companyId, set: values })
        .returning();
    return row!;
}

/** Disconnect: the workspace goes back to the deployment's models and the key is gone. */
export async function deleteWorkspaceEndpoint(
    companyId: bigint | number | string
): Promise<boolean> {
    const deleted = await db
        .delete(workspaceModelEndpoints)
        .where(eq(workspaceModelEndpoints.companyId, toNumericId(companyId)))
        .returning({ companyId: workspaceModelEndpoints.companyId });
    return deleted.length > 0;
}
