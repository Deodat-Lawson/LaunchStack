"use client";

import { FilePlus, FilePen, Folder, FileText, KeyRound, RotateCcw, ShieldOff } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";

import { CallLog, StandInBanner, Stat, useStandInState } from "../shared/ui";
import type { GoogleSnapshot } from "./dispatch";
import type { StandInFile } from "./world";

const FOLDER_MIME = "application/vnd.google-apps.folder";

/** Files under `parent`, folders first. */
function childrenOf(files: readonly StandInFile[], parent: string | null) {
    return files
        .filter(f => f.parent === parent && !f.trashed)
        .sort(
            (a, b) =>
                Number(b.mimeType === FOLDER_MIME) - Number(a.mimeType === FOLDER_MIME) ||
                a.name.localeCompare(b.name)
        );
}

function Tree({
    files,
    parent,
    granted,
}: {
    files: readonly StandInFile[];
    parent: string | null;
    granted: readonly string[];
}) {
    const kids = childrenOf(files, parent);
    if (kids.length === 0) return null;
    return (
        <ul className="border-line ml-3 flex flex-col gap-1 border-l pl-3">
            {kids.map(file => {
                const folder = file.mimeType === FOLDER_MIME;
                const Icon = folder ? Folder : FileText;
                return (
                    <li key={file.id}>
                        <div className="flex items-center gap-2 text-sm">
                            <Icon className="text-ink-3 size-4 shrink-0" aria-hidden />
                            <span className="min-w-0 truncate">{file.name}</span>
                            {file.version > 1 ? (
                                <span className="text-ink-3 text-[11px]">v{file.version}</span>
                            ) : null}
                            {granted.includes(file.id) ? (
                                <Badge variant="secondary">picked</Badge>
                            ) : null}
                            <span className="text-ink-3 ml-auto font-mono text-[11px]">
                                {file.id}
                            </span>
                        </div>
                        {folder ? <Tree files={files} parent={file.id} granted={granted} /> : null}
                    </li>
                );
            })}
        </ul>
    );
}

/** What the app has read from the Google stand-in, and buttons to change Drive under it. */
export function GoogleStandIn({
    initial,
    base,
    origin,
}: {
    initial: GoogleSnapshot;
    base: string;
    origin: string;
}) {
    const { state, busy, error, act } = useStandInState(base, initial);
    const roots: { label: string; id: string | null }[] = [
        { label: "My Drive", id: "root" },
        { label: "Shared with me", id: null },
    ];
    const sharedRoots = state.files.filter(f => f.parent === null && !f.driveId && !f.trashed);
    const drives = state.files.filter(f => f.parent === null && f.driveId === f.id);

    return (
        <div className="bg-surface text-ink min-h-dvh">
            <StandInBanner network="Google" />
            <header className="border-line bg-panel border-b">
                <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-4">
                    <div className="min-w-0">
                        <h1 className="display text-lg font-semibold">Google stand-in</h1>
                        <p className="text-ink-3 text-sm">
                            The Drive {state.account.email} sees. Point an app at{" "}
                            <span className="text-ink-2 font-mono">
                                {origin}
                                {base}
                            </span>{" "}
                            with GOOGLE_STAND_IN_URL.
                        </p>
                    </div>
                    <div className="ml-auto flex flex-wrap gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={busy !== null}
                            onClick={() =>
                                void act("add", { action: "add-file", folderId: "sa-financials" })
                            }
                        >
                            <FilePlus /> Add a file to Financials
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={busy !== null}
                            onClick={() =>
                                void act("edit", { action: "edit-file", fileId: "sa-readme" })
                            }
                        >
                            <FilePen /> Edit “Read me first”
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={busy !== null}
                            onClick={() => void act("forget", { action: "forget-grants" })}
                        >
                            <ShieldOff /> Forget picks
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={busy !== null}
                            onClick={() => void act("reset", { action: "reset" })}
                        >
                            <RotateCcw /> Reset
                        </Button>
                    </div>
                </div>
            </header>
            <main className="mx-auto grid max-w-6xl gap-4 px-4 py-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                {error ? <p className="text-danger text-sm lg:col-span-2">{error}</p> : null}
                <Card className="gap-4 p-5">
                    <div className="flex flex-wrap gap-6">
                        <Stat label="files and folders" value={state.files.length} />
                        <Stat label="picked (drive.file grants)" value={state.granted.length} />
                        <Stat label="live access tokens" value={state.tokens} />
                    </div>
                    {roots.map(root => (
                        <section key={root.label} className="flex flex-col gap-1.5">
                            <h2 className="text-ink-2 text-sm font-semibold">{root.label}</h2>
                            {root.id ? (
                                <Tree
                                    files={state.files}
                                    parent={root.id}
                                    granted={state.granted}
                                />
                            ) : (
                                <ul className="flex flex-col gap-1">
                                    {sharedRoots.map(f => (
                                        <li key={f.id}>
                                            <div className="flex items-center gap-2 text-sm">
                                                <Folder className="text-ink-3 size-4" aria-hidden />
                                                {f.name}
                                                <span className="text-ink-3 text-[11px]">
                                                    shared by {f.owner}
                                                </span>
                                                <span className="text-ink-3 ml-auto font-mono text-[11px]">
                                                    {f.id}
                                                </span>
                                            </div>
                                            <Tree
                                                files={state.files}
                                                parent={f.id}
                                                granted={state.granted}
                                            />
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>
                    ))}
                    <section className="flex flex-col gap-1.5">
                        <h2 className="text-ink-2 text-sm font-semibold">Shared drives</h2>
                        {drives.map(d => (
                            <div key={d.id}>
                                <div className="flex items-center gap-2 text-sm">
                                    <KeyRound className="text-ink-3 size-4" aria-hidden />
                                    {d.name}
                                    <span className="text-ink-3 ml-auto font-mono text-[11px]">
                                        {d.id}
                                    </span>
                                </div>
                                <Tree files={state.files} parent={d.id} granted={state.granted} />
                            </div>
                        ))}
                    </section>
                </Card>
                <Card className="gap-3 p-5">
                    <h2 className="text-ink-2 text-sm font-semibold">Recent calls</h2>
                    <CallLog calls={state.calls} now={state.now} />
                </Card>
            </main>
        </div>
    );
}
