/**
 * An Obsidian vault import, as the browser drives it: the panel reads the
 * vault (a folder or a .zip), posts its notes in batches, then says which
 * paths the vault has. Each batch stores what changed; the finish call flags
 * notes imported before that the vault no longer has.
 *
 * Runs in the request, like an upload — there is no remote to poll, so
 * there is nothing for the worker to do until ingestion picks the documents
 * up through the usual outbox event.
 */

import {
    importObsidianNotes,
    normalizeVaultPath,
    type ObsidianImportResult,
    type ObsidianNoteInput,
} from "@launchstack/pipelines/connectors/obsidian";

import type { OwnerRef } from "~/server/workspace/ownership";
import { createNoteFolders, ensureVaultFolder } from "./folder";
import { createObsidianSink, listKnownNotePaths, markMissingNotes } from "./sink";

export interface VaultBatchRequest {
    readonly owner: OwnerRef;
    readonly vaultName: string;
    readonly notes: readonly ObsidianNoteInput[];
    readonly force?: boolean;
    readonly requestUrl?: string;
}

export interface VaultBatchResult {
    readonly folder: string;
    readonly report: ObsidianImportResult;
}

export async function importVaultBatch(request: VaultBatchRequest): Promise<VaultBatchResult> {
    const { owner } = request;
    const folder = await ensureVaultFolder(owner, request.vaultName);
    const folders = createNoteFolders(owner.companyId, folder);
    const sink = await createObsidianSink({
        companyId: owner.companyId,
        ownerUserPk: owner.userPk,
        userId: owner.authUserId,
        vaultName: request.vaultName,
        folderFor: noteFolder => folders.folderFor(noteFolder),
        requestUrl: request.requestUrl,
    });
    const report = await importObsidianNotes({
        vaultName: request.vaultName,
        notes: request.notes,
        sink,
        force: request.force,
    });
    return { folder, report };
}

/**
 * The vault now has exactly `paths`: flag what was imported before and is
 * gone. Returns how many notes were flagged.
 */
export async function finishVaultImport(params: {
    readonly owner: OwnerRef;
    readonly vaultName: string;
    readonly paths: readonly string[];
}): Promise<number> {
    const { owner } = params;
    const present = new Set(params.paths.map(normalizeVaultPath));
    const known = await listKnownNotePaths(owner.companyId, owner.userPk, params.vaultName);
    const missing = known.filter(path => !present.has(path));
    await markMissingNotes(owner.companyId, owner.userPk, params.vaultName, missing);
    return missing.length;
}
