"use client";

import {
    FileMinus,
    FilePen,
    FilePlus,
    FileText,
    Folder,
    Globe,
    HardDrive,
    Mail,
    MailPlus,
    NotebookText,
    Paperclip,
    RotateCcw,
    ShieldOff,
    TimerOff,
} from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";

import { Ago, CallLog, StandInBanner, Stat, useStandInState } from "../shared/ui";
import type { MicrosoftSnapshot } from "./dispatch";

type Item = MicrosoftSnapshot["items"][number];
type Message = MicrosoftSnapshot["messages"][number];

const ICONS = { folder: Folder, file: FileText, notebook: NotebookText } as const;

function formatSize(bytes: number): string {
    return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function Tree({ items, parent }: { items: readonly Item[]; parent: string }) {
    const kids = items
        .filter(i => i.parent === parent)
        .sort(
            (a, b) =>
                Number(b.kind === "folder") - Number(a.kind === "folder") ||
                a.name.localeCompare(b.name)
        );
    if (kids.length === 0) return null;
    return (
        <ul className="border-line ml-3 flex flex-col gap-1 border-l pl-3">
            {kids.map(item => {
                const Icon = ICONS[item.kind];
                return (
                    <li key={item.id}>
                        <div className="flex items-center gap-2 text-sm">
                            <Icon className="text-ink-3 size-4 shrink-0" aria-hidden />
                            <span className="min-w-0 truncate">{item.name}</span>
                            {item.kind === "file" ? (
                                <span className="text-ink-3 shrink-0 text-[11px] tabular-nums">
                                    {formatSize(item.size)}
                                </span>
                            ) : null}
                            {item.kind === "notebook" ? (
                                <Badge variant="secondary">OneNote</Badge>
                            ) : null}
                            {item.version > 1 ? (
                                <span className="text-ink-3 shrink-0 text-[11px]">
                                    v{item.version}
                                </span>
                            ) : null}
                            <span className="text-ink-3 ml-auto shrink-0 font-mono text-[11px]">
                                {item.id}
                            </span>
                        </div>
                        {item.kind === "folder" ? <Tree items={items} parent={item.id} /> : null}
                    </li>
                );
            })}
        </ul>
    );
}

function MessageRow({ message, now }: { message: Message; now: number }) {
    return (
        <li className="flex items-baseline gap-2 text-sm">
            <span className="text-ink-2 w-32 shrink-0 truncate">{message.from}</span>
            <span className="min-w-0 flex-1 truncate">{message.subject}</span>
            {message.isDraft ? <Badge variant="warn">draft</Badge> : null}
            {message.attachments > 0 ? (
                <Paperclip className="text-ink-3 size-3.5 shrink-0 self-center" aria-hidden />
            ) : null}
            <Ago at={message.receivedAt} now={now} className="shrink-0 text-[11px]" />
        </li>
    );
}

/** What the app can read from the Microsoft stand-in, and buttons to change it underneath. */
export function MicrosoftStandIn({
    initial,
    base,
    origin,
}: {
    initial: MicrosoftSnapshot;
    base: string;
    origin: string;
}) {
    const { state, busy, error, act } = useStandInState(base, initial);
    const files = state.items.filter(i => i.kind === "file");
    const controls = [
        { key: "edit", label: "Edit a file", icon: FilePen, body: { action: "edit-file" } },
        { key: "remove", label: "Remove a file", icon: FileMinus, body: { action: "remove-file" } },
        { key: "add", label: "Add a file", icon: FilePlus, body: { action: "add-file" } },
        { key: "reply", label: "New reply arrives", icon: MailPlus, body: { action: "new-reply" } },
        {
            key: "revoke",
            label: "Revoke consent",
            icon: ShieldOff,
            body: { action: "revoke-grants" },
        },
        {
            key: "delta",
            label: "Expire delta links",
            icon: TimerOff,
            body: { action: "invalidate-delta" },
        },
        { key: "reset", label: "Reset", icon: RotateCcw, body: { action: "reset" } },
    ];

    return (
        <div className="bg-surface text-ink min-h-dvh">
            <StandInBanner network="Microsoft" />
            <header className="border-line bg-panel border-b">
                <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-4">
                    <div className="min-w-0">
                        <h1 className="display text-lg font-semibold">Microsoft stand-in</h1>
                        <p className="text-ink-3 text-sm">
                            OneDrive, SharePoint and Outlook for{" "}
                            {state.accounts.map(a => a.email).join(" and ")}. Point an app at{" "}
                            <span className="text-ink-2 font-mono">
                                {origin}
                                {base}
                            </span>{" "}
                            with MICROSOFT_STAND_IN_URL.
                        </p>
                    </div>
                    <div className="ml-auto flex flex-wrap gap-2">
                        {controls.map(control => (
                            <Button
                                key={control.key}
                                variant="outline"
                                size="sm"
                                disabled={busy !== null}
                                onClick={() => void act(control.key, control.body)}
                            >
                                <control.icon /> {control.label}
                            </Button>
                        ))}
                    </div>
                </div>
            </header>
            <main className="mx-auto grid max-w-6xl gap-4 px-4 py-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                {error ? <p className="text-danger text-sm lg:col-span-2">{error}</p> : null}
                <div className="flex min-w-0 flex-col gap-4">
                    <Card className="gap-4 p-5">
                        <div className="flex flex-wrap gap-6">
                            <Stat label="files" value={files.length} />
                            <Stat label="messages" value={state.messages.length} />
                            <Stat label="live access tokens" value={state.accessTokens} />
                            <Stat label="refresh tokens" value={state.refreshTokens} />
                        </div>
                        {state.drives.map(drive => {
                            const root = state.items.find(
                                i => i.driveId === drive.id && i.parent === null
                            );
                            const site = state.sites.find(s => s.id === drive.siteId);
                            const owner = state.accounts.find(a => a.driveId === drive.id);
                            const Icon = site ? Globe : HardDrive;
                            return (
                                <section key={drive.id} className="flex flex-col gap-1.5">
                                    <h2 className="text-ink-2 flex items-center gap-2 text-sm font-semibold">
                                        <Icon className="text-ink-3 size-4" aria-hidden />
                                        {site
                                            ? `${site.displayName} › ${drive.name}`
                                            : `${owner?.name ?? "Someone"}’s OneDrive`}
                                        <span className="text-ink-3 ml-auto font-mono text-[11px] font-normal">
                                            {drive.id}
                                        </span>
                                    </h2>
                                    {root ? <Tree items={state.items} parent={root.id} /> : null}
                                </section>
                            );
                        })}
                    </Card>
                    {state.accounts.map(account => (
                        <Card key={account.oid} className="gap-4 p-5">
                            <h2 className="text-ink-2 flex items-center gap-2 text-sm font-semibold">
                                <Mail className="text-ink-3 size-4" aria-hidden />
                                {account.name}’s mailbox
                                <span className="text-ink-3 font-normal">{account.email}</span>
                            </h2>
                            {state.mailFolders
                                .filter(f => f.oid === account.oid)
                                .map(folder => {
                                    const inside = state.messages.filter(
                                        m => m.folderId === folder.id
                                    );
                                    const parent = state.mailFolders.find(
                                        f => f.id === folder.parentFolderId
                                    );
                                    return (
                                        <section key={folder.id} className="flex flex-col gap-1.5">
                                            <h3 className="text-ink-3 flex items-center gap-2 text-xs font-semibold">
                                                {parent ? `${parent.displayName} › ` : ""}
                                                {folder.displayName}
                                                <span className="font-normal tabular-nums">
                                                    {inside.length}
                                                </span>
                                                <span className="ml-auto font-mono text-[11px] font-normal">
                                                    {folder.id}
                                                </span>
                                            </h3>
                                            <ul className="flex flex-col gap-1">
                                                {inside.map(m => (
                                                    <MessageRow
                                                        key={m.id}
                                                        message={m}
                                                        now={state.now}
                                                    />
                                                ))}
                                            </ul>
                                        </section>
                                    );
                                })}
                        </Card>
                    ))}
                </div>
                <Card className="gap-3 self-start p-5">
                    <h2 className="text-ink-2 text-sm font-semibold">Recent calls</h2>
                    <CallLog calls={state.calls} now={state.now} />
                </Card>
            </main>
        </div>
    );
}
