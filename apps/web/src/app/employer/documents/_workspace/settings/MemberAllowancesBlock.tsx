"use client";

/**
 * Settings › Usage › AI limits per person.
 *
 * Three things, top to bottom: the workspace default (a registry row, drawn
 * here beside the overrides it is the default for), the server's cap when the
 * operator set one (read-only: it is theirs, and it may not apply while the
 * workspace runs on its own model), and every member's use this month against
 * the limit that binds them, heaviest first. People with `settings.manage`
 * change one person's limit from their row.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Pencil } from "lucide-react";
import { toast } from "sonner";

import { Card, Section } from "~/components/layout/page-shell";
import { ProfileAvatar } from "~/components/ProfileAvatar";
import { Button } from "~/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "~/components/ui/table";
import { useSetting } from "~/lib/settings/useSettings";
import { cn } from "~/lib/utils";

import {
    AllowanceBar,
    allowanceTone,
    bindingLimit,
    MEMBER_LIMIT_SETTING_KEY,
    useAllowanceFormat,
    type AllowanceTone,
    type MemberAllowanceRow,
    type MemberAllowancesResponse,
    type MemberLimitChoice,
} from "./aiAllowance";
import { SettingRow } from "./SettingRow";
import { StatusNote } from "./ui";

/** `useTranslations("settings.usage.members")`. */
type MembersT = ReturnType<typeof useTranslations<"settings.usage.members">>;
type AllowanceFormat = ReturnType<typeof useAllowanceFormat>;

const TONE_TEXT: Record<AllowanceTone, string> = {
    normal: "text-ink-3",
    warn: "text-warn-ink",
    danger: "text-danger-ink",
};

/** Where a row's limit comes from, in a few words. */
function limitSource(t: MembersT, format: AllowanceFormat, member: MemberAllowanceRow): string {
    const binding = bindingLimit(member.allowance);
    if (binding?.source === "server") {
        return t("source.server", { used: format.compact(binding.used) });
    }
    return member.allowance.workspace.source === "member"
        ? t("source.member")
        : t("source.default");
}

export function MemberAllowancesBlock({
    refreshToken = 0,
}: {
    /** Bumped by the section's Refresh action. */
    refreshToken?: number;
}) {
    const t = useTranslations("settings.usage.members");
    const tc = useTranslations("common");
    const format = useAllowanceFormat();
    const [data, setData] = useState<MemberAllowancesResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState<MemberAllowanceRow | null>(null);
    const latest = useRef(0);

    const load = useCallback(async () => {
        const id = ++latest.current;
        setLoading(true);
        try {
            const res = await fetch("/api/settings/usage/members", {
                credentials: "same-origin",
                cache: "no-store",
            });
            const body = (await res
                .json()
                .catch(() => ({}))) as Partial<MemberAllowancesResponse> & {
                error?: string;
            };
            if (!res.ok)
                throw new Error(body.error ?? t("loadFailedStatus", { status: res.status }));
            if (!Array.isArray(body.members)) throw new Error(t("loadFailed"));
            if (id !== latest.current) return;
            setData(body as MemberAllowancesResponse);
            setError(null);
        } catch (err) {
            if (id === latest.current)
                setError(err instanceof Error ? err.message : t("loadFailed"));
        } finally {
            if (id === latest.current) setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        void load();
    }, [load, refreshToken]);

    // The default is edited in the row above the table; every limit that
    // follows it moves with it, so a change reloads the table.
    const workspaceDefault = useSetting<number>(MEMBER_LIMIT_SETTING_KEY);
    const seenDefault = useRef<number | null>(null);
    useEffect(() => {
        if (!workspaceDefault.loaded) return;
        const value = workspaceDefault.value;
        if (seenDefault.current !== null && seenDefault.current !== value) void load();
        seenDefault.current = value;
    }, [workspaceDefault.loaded, workspaceDefault.value, load]);

    const members = data?.members ?? [];
    const canEdit = data?.canEdit ?? false;

    return (
        <Section title={t("title")} description={t("description")}>
            <Card>
                <SettingRow settingKey={MEMBER_LIMIT_SETTING_KEY} scope="workspace" />
            </Card>

            {data?.serverCap && (
                <div className="mt-3.5">
                    <StatusNote tone="muted" style={{ marginBottom: 0 }}>
                        {data.serverCap.appliesHere
                            ? t("serverCap", { limit: format.tokens(data.serverCap.limit) })
                            : t("serverCapNotHere", { limit: format.tokens(data.serverCap.limit) })}
                    </StatusNote>
                </div>
            )}

            {error && (
                <div className="mt-3.5">
                    <StatusNote tone="danger" style={{ marginBottom: 0 }}>
                        {error}
                    </StatusNote>
                </div>
            )}

            {!data && loading && (
                <Card className="mt-3.5" padding={0}>
                    <div className="text-ink-3 px-5 py-4 text-[13px]">{tc("status.loading")}</div>
                </Card>
            )}

            {data && (
                <>
                    <Card padding={0} className="mt-3.5">
                        <Table
                            className={cn(loading && "opacity-60")}
                            aria-label={t("title")}
                            aria-busy={loading || undefined}
                        >
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t("person")}</TableHead>
                                    <TableHead className="text-right">{t("used")}</TableHead>
                                    <TableHead>{t("limit")}</TableHead>
                                    <TableHead>{t("progress")}</TableHead>
                                    {canEdit && (
                                        <TableHead>
                                            <span className="sr-only">{t("actions")}</span>
                                        </TableHead>
                                    )}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {members.map(member => (
                                    <MemberRow
                                        key={member.authUserId}
                                        member={member}
                                        canEdit={canEdit}
                                        onEdit={setEditing}
                                    />
                                ))}
                                {members.length === 0 && (
                                    <TableRow>
                                        <TableCell
                                            colSpan={canEdit ? 5 : 4}
                                            className="text-ink-3 text-center"
                                        >
                                            {t("empty")}
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </Card>
                    <div className="text-ink-3 mt-2 flex flex-col gap-0.5 text-[12px] leading-normal">
                        <span>
                            {t("period", {
                                start: format.longDate(data.period.start),
                                date: format.longDate(data.period.resetsAt),
                            })}
                        </span>
                        {data.unattributed > 0 && (
                            <span data-testid="unattributed-usage">
                                {t("unattributed", { tokens: format.tokens(data.unattributed) })}
                            </span>
                        )}
                    </div>
                </>
            )}

            {editing && data && (
                <MemberLimitDialog
                    member={editing}
                    workspaceDefault={data.workspaceDefault}
                    serverCap={data.serverCap}
                    onClose={() => setEditing(null)}
                    onSaved={member => {
                        setData(previous =>
                            previous
                                ? {
                                      ...previous,
                                      members: previous.members.map(row =>
                                          row.authUserId === member.authUserId ? member : row
                                      ),
                                  }
                                : previous
                        );
                        setEditing(null);
                    }}
                />
            )}
        </Section>
    );
}

function MemberRow({
    member,
    canEdit,
    onEdit,
}: {
    member: MemberAllowanceRow;
    canEdit: boolean;
    onEdit: (member: MemberAllowanceRow) => void;
}) {
    const t = useTranslations("settings.usage.members");
    const format = useAllowanceFormat();
    const { allowance } = member;
    const binding = bindingLimit(allowance);
    const percent = binding ? allowance.percent : null;
    const tone = allowanceTone(percent, allowance.blocked);

    return (
        <TableRow data-testid={`member-allowance-${member.authUserId}`}>
            <TableCell>
                <div className="flex min-w-0 items-center gap-2.5">
                    <ProfileAvatar
                        name={member.displayName}
                        email={member.email}
                        src={member.avatarUrl}
                        className="size-7"
                        fallbackClassName="text-[10px]"
                    />
                    <div className="min-w-0">
                        <div className="text-ink font-medium">
                            {member.displayName}
                            {member.isSelf && (
                                <span className="text-ink-3 font-normal"> {t("you")}</span>
                            )}
                        </div>
                        <div className="text-ink-3 text-[12px]">{member.email}</div>
                    </div>
                </div>
            </TableCell>
            <TableCell
                className="text-ink text-right tabular-nums"
                title={t("exactTokens", { value: format.tokens(allowance.used) })}
            >
                {format.compact(allowance.used)}
            </TableCell>
            <TableCell>
                <div
                    className="text-ink tabular-nums"
                    title={
                        binding
                            ? t("exactTokens", { value: format.tokens(binding.limit) })
                            : undefined
                    }
                >
                    {binding ? format.compact(binding.limit) : t("noLimit")}
                </div>
                <div className="text-ink-3 text-[12px]">{limitSource(t, format, member)}</div>
            </TableCell>
            <TableCell>
                {percent !== null ? (
                    <div className="flex items-center gap-2">
                        <AllowanceBar
                            percent={percent}
                            blocked={allowance.blocked}
                            label={t("progressLabel", {
                                name: member.displayName,
                                percent: format.percent(percent),
                            })}
                            className="w-24 sm:w-32"
                        />
                        <span className={cn("text-[12px] tabular-nums", TONE_TEXT[tone])}>
                            {format.share(percent)}
                        </span>
                    </div>
                ) : (
                    <span className="text-ink-4">—</span>
                )}
            </TableCell>
            {canEdit && (
                <TableCell className="text-right">
                    <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t("editLimitFor", { name: member.displayName })}
                        onClick={() => onEdit(member)}
                    >
                        <Pencil className="size-3.5" />
                        {t("editLimit")}
                    </Button>
                </TableCell>
            )}
        </TableRow>
    );
}

/** Tokens typed by a person: digits, with the separators people type. */
function parseTokens(raw: string): number | null {
    const value = Number(raw.trim().replace(/[\s,_]/g, ""));
    return Number.isInteger(value) && value >= 1 ? value : null;
}

function MemberLimitDialog({
    member,
    workspaceDefault,
    serverCap,
    onClose,
    onSaved,
}: {
    member: MemberAllowanceRow;
    workspaceDefault: number | null;
    serverCap: MemberAllowancesResponse["serverCap"];
    onClose: () => void;
    onSaved: (member: MemberAllowanceRow) => void;
}) {
    const t = useTranslations("settings.usage.members.dialog");
    const tc = useTranslations("common");
    const format = useAllowanceFormat();
    const [mode, setMode] = useState<MemberLimitChoice["mode"]>(member.choice.mode);
    const [custom, setCustom] = useState(() =>
        member.choice.mode === "custom"
            ? String(member.choice.monthlyTokens)
            : workspaceDefault !== null
              ? String(workspaceDefault)
              : ""
    );
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const customInvalid = mode === "custom" && parseTokens(custom) === null;

    const save = async (event: React.FormEvent) => {
        event.preventDefault();
        let choice: MemberLimitChoice;
        if (mode === "custom") {
            const monthlyTokens = parseTokens(custom);
            if (monthlyTokens === null) {
                setError(t("customInvalid"));
                return;
            }
            choice = { mode: "custom", monthlyTokens };
        } else {
            choice = { mode };
        }
        setBusy(true);
        setError(null);
        try {
            const res = await fetch(
                `/api/settings/usage/members/${encodeURIComponent(member.authUserId)}`,
                {
                    method: "PUT",
                    credentials: "same-origin",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(choice),
                }
            );
            const body = (await res.json().catch(() => ({}))) as {
                member?: MemberAllowanceRow;
                error?: string;
            };
            if (!res.ok || !body.member) {
                throw new Error(body.error ?? t("saveFailedStatus", { status: res.status }));
            }
            toast.success(t("saved", { name: member.displayName }));
            onSaved(body.member);
        } catch (err) {
            setError(err instanceof Error ? err.message : t("saveFailed"));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog
            open
            onOpenChange={next => {
                if (!next && !busy) onClose();
            }}
        >
            <DialogContent>
                {/* noValidate: the form says what's wrong in the reader's language, not the browser's. */}
                <form noValidate onSubmit={e => void save(e)} className="flex flex-col gap-4">
                    <DialogHeader>
                        <DialogTitle>{t("title", { name: member.displayName })}</DialogTitle>
                        <DialogDescription>{t("description")}</DialogDescription>
                    </DialogHeader>
                    <RadioGroup
                        value={mode}
                        onValueChange={value => {
                            setMode(value as MemberLimitChoice["mode"]);
                            setError(null);
                        }}
                        aria-label={t("choiceLabel")}
                        disabled={busy}
                        className="gap-3"
                    >
                        <div className="flex items-center gap-2.5">
                            <RadioGroupItem value="default" id="ai-limit-default" />
                            <Label htmlFor="ai-limit-default" className="font-normal">
                                {workspaceDefault === null
                                    ? t("defaultNone")
                                    : t("default", { limit: format.tokens(workspaceDefault) })}
                            </Label>
                        </div>
                        <div className="flex items-center gap-2.5">
                            <RadioGroupItem value="none" id="ai-limit-none" />
                            <Label htmlFor="ai-limit-none" className="font-normal">
                                {t("none")}
                            </Label>
                        </div>
                        <div className="flex items-center gap-2.5">
                            <RadioGroupItem value="custom" id="ai-limit-custom" />
                            <Label htmlFor="ai-limit-custom" className="font-normal">
                                {t("custom")}
                            </Label>
                        </div>
                    </RadioGroup>
                    {mode === "custom" && (
                        <div className="flex flex-col gap-1.5 pl-[26px]">
                            <Label htmlFor="ai-limit-custom-tokens">{t("customLabel")}</Label>
                            <Input
                                id="ai-limit-custom-tokens"
                                type="number"
                                inputMode="numeric"
                                min={1}
                                step={1}
                                value={custom}
                                onChange={e => setCustom(e.target.value)}
                                aria-invalid={customInvalid || undefined}
                                disabled={busy}
                                autoFocus
                            />
                        </div>
                    )}
                    {serverCap?.appliesHere && (
                        <p className="text-ink-3 m-0 text-[12.5px] leading-normal">
                            {t("serverStillApplies", { limit: format.tokens(serverCap.limit) })}
                        </p>
                    )}
                    {error && (
                        <StatusNote tone="danger" style={{ marginBottom: 0 }}>
                            {error}
                        </StatusNote>
                    )}
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                            {tc("actions.cancel")}
                        </Button>
                        <Button type="submit" disabled={busy}>
                            {busy ? tc("status.saving") : tc("actions.save")}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
