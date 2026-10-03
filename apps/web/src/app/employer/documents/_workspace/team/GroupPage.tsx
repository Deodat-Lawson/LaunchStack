"use client";

/**
 * One group, in the Team tab: who is in it, as cards that open each person,
 * and — for its creator or a `groups.manage` holder — add people, remove
 * them, rename, delete.
 */

import React, { useMemo, useState } from "react";
import { MoreHorizontal, Pencil, Search, Trash2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";

import { ProfileAvatar } from "~/components/ProfileAvatar";
import { ToolLink } from "~/components/tool-app/ToolLink";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";

import { errorMessage, peopleApi, type Group, type Member } from "../settings/people/api";
import { plural } from "../settings/people/format";
import { GroupDialog } from "../settings/people/GroupsTab";
import { teamPaths } from "./screens";
import { BackButton, EmptyLine } from "./ui";

export function GroupPage({
    group,
    members,
    byId,
    onBack,
    onChanged,
    onDeleted,
}: {
    group: Group;
    /** Everyone in the workspace, for "Add people". */
    members: Member[];
    byId: Map<number, Member>;
    onBack: () => void;
    onChanged: (group: Group) => void;
    onDeleted: (groupId: number) => void;
}) {
    const canManage = group.canManage === true;
    const [busy, setBusy] = useState(false);
    const [renaming, setRenaming] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const creator = useMemo(
        () => (group.createdBy ? members.find(m => m.authUserId === group.createdBy) : undefined),
        [group.createdBy, members]
    );

    const remove = async (memberId: number, name: string) => {
        setBusy(true);
        try {
            const res = await peopleApi.groups.removeMembers(group.id, [memberId]);
            onChanged(res.group);
            toast.success(`${name} removed from ${group.name}`);
        } catch (err) {
            toast.error(errorMessage(err, "Couldn't remove them from the group."));
        } finally {
            setBusy(false);
        }
    };

    const add = async (member: Member) => {
        setBusy(true);
        try {
            const res = await peopleApi.groups.addMembers(group.id, [member.id]);
            onChanged(res.group);
            toast.success(`${member.displayName} added to ${group.name}`);
        } catch (err) {
            toast.error(errorMessage(err, "Couldn't add them to the group."));
        } finally {
            setBusy(false);
        }
    };

    const destroy = async () => {
        setBusy(true);
        try {
            await peopleApi.groups.remove(group.id);
            toast.success(`${group.name} deleted`);
            onDeleted(group.id);
        } catch (err) {
            toast.error(errorMessage(err, "The group wasn't deleted."));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="mx-auto flex max-w-[1100px] flex-col gap-5" data-testid="team-group">
            <div>
                <BackButton label="Groups" onClick={onBack} />
            </div>

            <header className="@max-md:grid-cols-1 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                <div className="min-w-0">
                    <h1 className="display text-ink m-0 text-[26px] leading-[1.15] tracking-[-0.02em]">
                        {group.name}
                    </h1>
                    {group.description && (
                        <p className="text-ink-2 m-0 mt-1 max-w-[70ch] text-[13px] leading-snug">
                            {group.description}
                        </p>
                    )}
                    <p className="text-ink-3 m-0 mt-1.5 text-[12px]">
                        {plural(group.memberCount, "member")}
                        {creator
                            ? ` · made by ${creator.isSelf ? "you" : creator.displayName}`
                            : ""}
                    </p>
                </div>
                {canManage && (
                    <div className="flex items-center gap-1.5">
                        <AddPeople group={group} members={members} busy={busy} onAdd={add} />
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="text-ink-2 size-8"
                                    aria-label={`Actions for ${group.name}`}
                                >
                                    <MoreHorizontal className="size-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => setRenaming(true)}>
                                    <Pencil /> Rename
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    variant="destructive"
                                    onSelect={() => setDeleting(true)}
                                >
                                    <Trash2 /> Delete group
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                )}
            </header>

            {group.members.length === 0 ? (
                <EmptyLine flush>
                    {canManage
                        ? "Nobody is in this group yet. Add people, then share with the group in one step."
                        : "Nobody is in this group yet."}
                </EmptyLine>
            ) : (
                <ul
                    className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3 p-0"
                    data-testid="team-group-members"
                >
                    {group.members.map(m => {
                        const person = byId.get(m.id);
                        const name = person?.displayName ?? (m.name || m.email);
                        const face = (
                            <>
                                <ProfileAvatar
                                    name={name}
                                    email={m.email}
                                    src={person?.avatarUrl}
                                    className="size-9"
                                    fallbackClassName="text-[11px]"
                                />
                                <span className="min-w-0 flex-1">
                                    <span className="text-ink block truncate text-[13px] font-medium">
                                        {name}
                                        {person?.isSelf && (
                                            <span className="text-ink-3 font-normal"> (you)</span>
                                        )}
                                    </span>
                                    <span className="text-ink-3 block truncate text-[11.5px]">
                                        {person?.title ?? m.email}
                                    </span>
                                </span>
                            </>
                        );
                        return (
                            <li
                                key={m.id}
                                className="border-line bg-panel group/row flex min-w-0 items-center rounded-lg border pr-1.5"
                            >
                                {person ? (
                                    <ToolLink
                                        href={teamPaths.person(m.id)}
                                        className="hover:bg-panel-2 focus-visible:bg-panel-2 flex min-w-0 flex-1 items-center gap-2.5 rounded-l-lg p-3 no-underline outline-none"
                                    >
                                        {face}
                                    </ToolLink>
                                ) : (
                                    // Not an active member any more: nothing to open.
                                    <div className="flex min-w-0 flex-1 items-center gap-2.5 p-3">
                                        {face}
                                    </div>
                                )}
                                {canManage && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        disabled={busy}
                                        onClick={() => void remove(m.id, name)}
                                        aria-label={`Remove ${name} from ${group.name}`}
                                        // Shown on hover; always on a touch screen, which has none.
                                        className="text-ink-3 hover:text-danger size-7 shrink-0 opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100"
                                    >
                                        <X className="size-3.5" />
                                    </Button>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            <GroupDialog
                group={renaming ? group : null}
                onClose={() => setRenaming(false)}
                onSaved={saved => {
                    onChanged(saved);
                    setRenaming(false);
                }}
            />
            <ConfirmDialog
                open={deleting}
                onOpenChange={setDeleting}
                title={`Delete ${group.name}?`}
                description={`Folders, files and chats shared with this group stop reaching its ${plural(
                    group.memberCount,
                    "member"
                )}. Nobody leaves the workspace.`}
                confirmLabel="Delete group"
                onConfirm={() => void destroy()}
            />
        </div>
    );
}

function AddPeople({
    group,
    members,
    busy,
    onAdd,
}: {
    group: Group;
    members: Member[];
    busy: boolean;
    onAdd: (member: Member) => Promise<void>;
}) {
    const [open, setOpen] = useState(false);
    const [filter, setFilter] = useState("");
    const inGroup = useMemo(() => new Set(group.members.map(m => m.id)), [group.members]);
    const needle = filter.trim().toLowerCase();
    const candidates = members.filter(
        m =>
            !inGroup.has(m.id) &&
            (!needle ||
                m.displayName.toLowerCase().includes(needle) ||
                m.email.toLowerCase().includes(needle))
    );

    return (
        <Popover
            open={open}
            onOpenChange={next => {
                setOpen(next);
                if (!next) setFilter("");
            }}
        >
            <PopoverTrigger asChild>
                <Button size="sm" data-testid="team-group-add">
                    <UserPlus className="size-3.5" />
                    Add people
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={6} className="w-[260px] p-0">
                <div className="border-line border-b p-2">
                    <div className="relative">
                        <Search className="text-ink-3 pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2" />
                        <Input
                            value={filter}
                            onChange={e => setFilter(e.target.value)}
                            placeholder="Find a person"
                            aria-label="Find a person to add"
                            className="h-8 pl-8 text-[13px]"
                            autoFocus
                        />
                    </div>
                </div>
                <div className="max-h-[280px] overflow-y-auto py-1">
                    {candidates.length === 0 ? (
                        <p className="text-ink-3 m-0 px-3 py-3 text-[12.5px]">
                            {needle
                                ? `Nobody else matches “${filter.trim()}”.`
                                : "Everyone is already in this group."}
                        </p>
                    ) : (
                        candidates.map(m => (
                            <button
                                key={m.id}
                                type="button"
                                disabled={busy}
                                onClick={() => void onAdd(m)}
                                className="hover:bg-panel-2 focus-visible:bg-panel-2 flex w-full items-center gap-2 px-3 py-1.5 text-left outline-none disabled:opacity-50"
                            >
                                <ProfileAvatar
                                    name={m.displayName}
                                    email={m.email}
                                    src={m.avatarUrl}
                                    className="size-6"
                                    fallbackClassName="text-[9px]"
                                />
                                <span className="text-ink min-w-0 flex-1 truncate text-[12.5px]">
                                    {m.displayName}
                                </span>
                            </button>
                        ))
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}
