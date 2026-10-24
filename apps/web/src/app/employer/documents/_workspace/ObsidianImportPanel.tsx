"use client";

/**
 * The Obsidian tab — import a vault, and re-import it to bring changes in.
 *
 * Obsidian has no cloud API (a vault is a folder on someone's disk), so
 * "connecting" means reading the vault here in the browser: pick the vault
 * folder, or a .zip of it. Only notes are read (`.obsidian/`, `.trash/`,
 * attachments and drawings are left out, by the same rules the server
 * applies), they are posted in batches, and the server stores only notes
 * that changed since the last import. The last call names every note the
 * vault still has, so notes deleted in Obsidian are flagged here too.
 *
 * Notes land in `Obsidian/<vault>`, a folder only the importer can see until
 * they share it.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { FileArchive, Folder as IconFolder, RefreshCw } from "lucide-react";

import {
    isVaultNotePath,
    normalizeVaultPath,
} from "@launchstack/pipelines/connectors/obsidian/paths";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Progress } from "~/components/ui/progress";

const IMPORT_URL = "/api/connectors/obsidian/import";
/** The server takes at most 200 notes a batch; bytes keep a batch well under the body limit. */
const BATCH_NOTES = 200;
const BATCH_BYTES = 4 * 1024 * 1024;

interface VaultNote {
    readonly path: string;
    readonly bytes: number;
    readonly modifiedAt: string | null;
    readonly read: () => Promise<string>;
}

interface PickedVault {
    readonly name: string;
    readonly notes: readonly VaultNote[];
    /** Files in the pick that are not notes (settings, attachments, trash). */
    readonly ignored: number;
    /** A `.obsidian` settings folder was in the pick. */
    readonly looksLikeVault: boolean;
}

interface ImportedVault {
    readonly vaultName: string;
    readonly notes: number;
    readonly lastImportedAt: string | null;
}

interface ImportTotals {
    stored: number;
    unchanged: number;
    skipped: number;
    failed: number;
    missing: number;
    folder: string | null;
}

interface BatchResponse {
    readonly folder: string;
    readonly stored: number;
    readonly unchanged: number;
    readonly skipped: readonly unknown[];
    readonly failed: readonly unknown[];
}

/** Drop the first path segment: the vault folder itself, or a zip's top folder. */
function withinRoot(path: string): string {
    return normalizeVaultPath(path).split("/").slice(1).join("/");
}

function hasSettingsFolder(paths: readonly string[]): boolean {
    return paths.some(path => path.split("/").includes(".obsidian"));
}

function fromFolder(files: FileList): PickedVault | null {
    const all = Array.from(files);
    if (all.length === 0) return null;
    const first = normalizeVaultPath(all[0]!.webkitRelativePath || all[0]!.name);
    const name = first.split("/")[0] ?? "Vault";
    const relative = all.map(file => ({
        file,
        path: withinRoot(file.webkitRelativePath || file.name),
    }));
    const notes = relative
        .filter(entry => isVaultNotePath(entry.path))
        .map(entry => ({
            path: entry.path,
            bytes: entry.file.size,
            modifiedAt: entry.file.lastModified
                ? new Date(entry.file.lastModified).toISOString()
                : null,
            read: () => entry.file.text(),
        }));
    return {
        name,
        notes,
        ignored: all.length - notes.length,
        looksLikeVault: hasSettingsFolder(relative.map(entry => entry.path)),
    };
}

async function fromZip(file: File): Promise<PickedVault> {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(file);
    const entries = Object.values(zip.files).filter(entry => !entry.dir);
    const paths = entries.map(entry => normalizeVaultPath(entry.name));
    // A zip of the vault folder has one top folder: that is the vault.
    const tops = new Set(paths.map(path => path.split("/")[0]));
    const nested = tops.size === 1 && paths.every(path => path.includes("/"));
    const name = nested ? [...tops][0]! : file.name.replace(/\.zip$/i, "") || "Vault";
    const relative = entries.map((entry, index) => ({
        entry,
        path: nested ? withinRoot(paths[index]!) : paths[index]!,
    }));
    const notes = relative
        .filter(item => isVaultNotePath(item.path))
        .map(item => ({
            path: item.path,
            // Uncompressed size is not public API; a note's text is read once anyway.
            bytes: 0,
            modifiedAt: item.entry.date ? item.entry.date.toISOString() : null,
            read: () => item.entry.async("string"),
        }));
    return {
        name,
        notes,
        ignored: entries.length - notes.length,
        looksLikeVault: hasSettingsFolder(relative.map(item => item.path)),
    };
}

async function postJson(url: string, body: unknown): Promise<Response> {
    return fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

/** "12 imported · 3 unchanged · 1 failed — in Obsidian/Notes". */
function totalsLine(
    t: ReturnType<typeof useTranslations<"sources.obsidianImport">>,
    totals: ImportTotals
): string {
    const parts = [
        t("totals.imported", { count: totals.stored }),
        t("totals.unchanged", { count: totals.unchanged }),
    ];
    if (totals.skipped > 0) parts.push(t("totals.skipped", { count: totals.skipped }));
    if (totals.failed > 0) parts.push(t("totals.failed", { count: totals.failed }));
    if (totals.missing > 0) parts.push(t("totals.missing", { count: totals.missing }));
    const summary = parts.join(" · ");
    return totals.folder ? t("totals.inFolder", { summary, folder: totals.folder }) : summary;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
    try {
        const payload = (await res.json()) as { message?: string; error?: string };
        return payload.message ?? payload.error ?? fallback;
    } catch {
        return fallback;
    }
}

export function ObsidianImportPanel({ onImported }: { readonly onImported: () => void }) {
    const t = useTranslations("sources.obsidianImport");
    const format = useFormatter();
    const folderInput = useRef<HTMLInputElement>(null);
    const zipInput = useRef<HTMLInputElement>(null);
    const [picked, setPicked] = useState<PickedVault | null>(null);
    const [vaultName, setVaultName] = useState("");
    const [reading, setReading] = useState(false);
    const [importing, setImporting] = useState(false);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const [totals, setTotals] = useState<ImportTotals | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [vaults, setVaults] = useState<readonly ImportedVault[]>([]);

    const loadVaults = useCallback(async () => {
        try {
            const res = await fetch(IMPORT_URL);
            if (!res.ok) return;
            const payload = (await res.json()) as { data?: { vaults?: ImportedVault[] } };
            setVaults(payload.data?.vaults ?? []);
        } catch {
            // The list is a convenience; importing works without it.
        }
    }, []);

    useEffect(() => {
        void loadVaults();
    }, [loadVaults]);

    const choose = (vault: PickedVault | null) => {
        setPicked(vault);
        setVaultName(vault?.name ?? "");
        setTotals(null);
        setError(null);
        if (vault && vault.notes.length === 0) {
            setError(t("noNotes"));
        }
    };

    const onZipPicked = async (file: File | undefined) => {
        if (!file) return;
        setReading(true);
        try {
            choose(await fromZip(file));
        } catch {
            choose(null);
            setError(t("zipFailed"));
        } finally {
            setReading(false);
        }
    };

    const runImport = async () => {
        if (!picked || picked.notes.length === 0) return;
        const name = vaultName.trim() || picked.name;
        setImporting(true);
        setError(null);
        const sum: ImportTotals = {
            stored: 0,
            unchanged: 0,
            skipped: 0,
            failed: 0,
            missing: 0,
            folder: null,
        };
        setProgress({ done: 0, total: picked.notes.length });
        try {
            let index = 0;
            while (index < picked.notes.length) {
                const batch: { path: string; text: string; modifiedAt: string | null }[] = [];
                let bytes = 0;
                while (index < picked.notes.length && batch.length < BATCH_NOTES) {
                    const note = picked.notes[index]!;
                    const text = await note.read();
                    const size = new Blob([text]).size;
                    if (batch.length > 0 && bytes + size > BATCH_BYTES) break;
                    batch.push({ path: note.path, text, modifiedAt: note.modifiedAt });
                    bytes += size;
                    index++;
                }
                const res = await postJson(IMPORT_URL, { vault: name, notes: batch });
                if (!res.ok) {
                    throw new Error(
                        await errorMessage(res, t("stoppedAfter", { count: index - batch.length }))
                    );
                }
                const payload = (await res.json()) as { data?: BatchResponse };
                const data = payload.data;
                if (data) {
                    sum.stored += data.stored;
                    sum.unchanged += data.unchanged;
                    sum.skipped += data.skipped.length;
                    sum.failed += data.failed.length;
                    sum.folder = data.folder;
                }
                setProgress({ done: index, total: picked.notes.length });
            }

            const finish = await postJson(`${IMPORT_URL}/finish`, {
                vault: name,
                paths: picked.notes.map(note => note.path),
            });
            if (!finish.ok) {
                // The notes are in, but notes deleted from the vault were not
                // flagged: say so, so the user imports again rather than trusting it.
                throw new Error(await errorMessage(finish, t("finishFailed")));
            }
            const payload = (await finish.json()) as { data?: { missing?: number } };
            sum.missing = payload.data?.missing ?? 0;

            setTotals(sum);
            toast.success(
                sum.stored > 0
                    ? t("imported", { count: sum.stored, name })
                    : t("upToDate", { name })
            );
            onImported();
            void loadVaults();
        } catch (failure) {
            setTotals(sum);
            setError(failure instanceof Error ? failure.message : t("importFailed"));
        } finally {
            setImporting(false);
            setProgress(null);
        }
    };

    return (
        <div>
            <input
                ref={folderInput}
                type="file"
                // @ts-expect-error — `webkitdirectory` is a non-standard HTMLInputElement attribute
                webkitdirectory=""
                directory=""
                multiple
                className="hidden"
                onChange={event => {
                    choose(event.target.files ? fromFolder(event.target.files) : null);
                    event.target.value = "";
                }}
            />
            <input
                ref={zipInput}
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                onChange={event => {
                    void onZipPicked(event.target.files?.[0]);
                    event.target.value = "";
                }}
            />

            {!picked ? (
                <div className="border-line bg-line-2 rounded-xl border-[1.5px] border-dashed px-6 py-8 text-center">
                    <div className="text-ink mb-1 text-[15px] font-semibold">{t("title")}</div>
                    <p className="text-ink-3 mx-auto mb-4 max-w-[400px] text-[13px]">
                        {t("intro")}
                    </p>
                    <div className="flex flex-wrap justify-center gap-2">
                        <Button type="button" onClick={() => folderInput.current?.click()}>
                            <IconFolder aria-hidden />
                            {t("chooseFolder")}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={reading}
                            onClick={() => zipInput.current?.click()}
                        >
                            <FileArchive aria-hidden />
                            {reading ? t("reading") : t("chooseZip")}
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="border-line bg-panel rounded-xl border p-4">
                    <div className="text-ink text-[13.5px] font-semibold">
                        {t("notesFound", { count: picked.notes.length })}
                    </div>
                    <div className="text-ink-3 mb-3 text-[12px]">
                        {picked.looksLikeVault ? t("looksLikeVault") : t("noSettingsFolder")}
                        {picked.ignored > 0
                            ? ` · ${t("otherFilesLeftOut", { count: picked.ignored })}`
                            : ""}
                    </div>
                    <label
                        className="text-ink-2 mb-1 block text-[12px] font-medium"
                        htmlFor="obsidian-vault-name"
                    >
                        {t("vaultName")}
                    </label>
                    <Input
                        id="obsidian-vault-name"
                        value={vaultName}
                        maxLength={120}
                        disabled={importing}
                        onChange={event => setVaultName(event.target.value)}
                    />
                    <p className="text-ink-3 mb-3 mt-1 text-[12px]">{t("reimportHint")}</p>
                    {progress && (
                        <div className="mb-3">
                            <Progress value={(progress.done / Math.max(progress.total, 1)) * 100} />
                            <div className="text-ink-3 mt-1 text-[12px]">
                                {t("progress", { done: progress.done, total: progress.total })}
                            </div>
                        </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                        <Button
                            type="button"
                            disabled={importing || picked.notes.length === 0}
                            onClick={() => void runImport()}
                        >
                            {importing ? t("importing") : t("importNotes")}
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            disabled={importing}
                            onClick={() => choose(null)}
                        >
                            {t("chooseAnother")}
                        </Button>
                    </div>
                </div>
            )}

            {error && <p className="text-danger mt-3 text-[13px]">{error}</p>}

            {totals && (
                <div
                    role="status"
                    className="border-line bg-line-2 text-ink-2 mt-3 rounded-lg border px-3 py-2.5 text-[12.5px]"
                >
                    {totalsLine(t, totals)}
                </div>
            )}

            {vaults.length > 0 && (
                <div className="mt-4">
                    <div className="text-ink-3 mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide">
                        {t("importedVaults")}
                    </div>
                    <ul className="flex flex-col gap-1.5">
                        {vaults.map(vault => (
                            <li
                                key={vault.vaultName}
                                className="border-line text-ink-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-[12.5px]"
                            >
                                <RefreshCw className="text-ink-3 size-3.5 shrink-0" aria-hidden />
                                <span className="text-ink min-w-0 flex-1 truncate font-medium">
                                    {vault.vaultName}
                                </span>
                                <span>
                                    {t("vaultNotes", { count: vault.notes })}
                                    {vault.lastImportedAt
                                        ? ` · ${format.dateTime(new Date(vault.lastImportedAt), {
                                              dateStyle: "medium",
                                          })}`
                                        : ""}
                                </span>
                            </li>
                        ))}
                    </ul>
                    <p className="text-ink-3 mt-1.5 text-[12px]">{t("updateHint")}</p>
                </div>
            )}
        </div>
    );
}
