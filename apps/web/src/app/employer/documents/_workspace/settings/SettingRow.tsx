"use client";

/**
 * One registry-backed setting as a row.
 *
 * The row knows three things the old hand-built forms did not: where its
 * value came from (a quiet "Inherited from workspace" marker with a *Set
 * here* action, or "Set here" with *Reset*), that a consequence is stated
 * above the control rather than in a toast afterwards, and that a person
 * without the permission sees the value and who set it with the control
 * disabled — policy is never hidden from the people it governs.
 */

import React, { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Layers } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { usePermissionCopy } from "~/lib/authz/i18n";
import { usePerson } from "~/lib/profile/use-people";
import { settingsForSection, type SettingDefinition } from "~/lib/settings/registry";
import type {
    SettingOption,
    SettingScope,
    SettingsSectionId,
    StoredScope,
} from "~/lib/settings/types";
import {
    defaultWriteScope,
    settingAtScope,
    useSetting,
    useSettingCopy,
    useSettingsPayload,
    type SettingCopy,
} from "~/lib/settings/useSettings";
import { cn } from "~/lib/utils";

import { useTimeFormat } from "./people/format";

/** `useTranslations("settings.row")`. */
type RowT = ReturnType<typeof useTranslations<"settings.row">>;

export interface SettingRowProps {
    settingKey: string;
    /** Folder in view, for folder-scoped values. */
    folder?: string | null;
    /** Force the write scope. Default: the most specific scope the setting allows. */
    scope?: StoredScope;
    /** Replace the registry's options (e.g. only the OCR providers this server has). */
    options?: readonly SettingOption[];
    /** Disable with a reason the row states, beyond permissions. */
    disabledReason?: string | null;
    /** Extra content under the control — a live preview, a link. */
    children?: ReactNode;
}

function sameValue(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

export function SettingRow({
    settingKey,
    folder = null,
    scope,
    options,
    disabledReason = null,
    children,
}: SettingRowProps) {
    const t = useTranslations("settings.row");
    const tc = useTranslations("common");
    const setting = useSetting(settingKey, { folder });
    const { definition, resolved, loaded, saving, saveError } = setting;
    const copy = useSettingCopy(definition);
    const permissionCopy = usePermissionCopy();
    const writeScope = scope ?? defaultWriteScope(definition, folder);
    // A row pinned to a broader scope than the winning value shows that
    // scope's value: the workspace row is not where an admin's own choice goes.
    const { value, source } = settingAtScope(definition, resolved, writeScope);
    const canEdit = resolved ? resolved.canEdit[writeScope] : false;
    const disabled = !loaded || saving || !canEdit || Boolean(disabledReason);
    const [highlight, setHighlight] = useState(false);

    // `#setting.key` deep links land here: the hub switches section, then the
    // row scrolls itself into view and flashes once.
    useEffect(() => {
        const wanted =
            typeof window !== "undefined" &&
            window.location.hash.replace("#", "").toLowerCase() === definition.key.toLowerCase();
        if (!wanted) return;
        const el = document.getElementById(`setting-${definition.key}`);
        el?.scrollIntoView({ block: "center" });
        setHighlight(true);
        const timer = window.setTimeout(() => setHighlight(false), 1800);
        return () => window.clearTimeout(timer);
    }, [definition.key]);

    const commit = useCallback(
        (next: unknown) => {
            void setting.set(next, writeScope).catch(() => undefined);
        },
        [setting, writeScope]
    );

    // The description is quoted, not spliced into a sentence: some are verb
    // phrases ("Send invitations…") and some are lists ("Workspace settings,
    // processing, …"), and splicing a list read "people who can workspace
    // settings".
    const permissionReason = !canEdit
        ? definition.permission
            ? t("permissionReason", { permission: permissionCopy(definition.permission) })
            : t("notEditable")
        : null;
    const readOnlyReason = !loaded ? null : (disabledReason ?? permissionReason);

    const provenance = describeProvenance(t, resolved, source, writeScope, folder);
    const showReset =
        canEdit &&
        resolved &&
        resolved.stored[writeScope] !== undefined &&
        (writeScope !== "workspace" || !definition.bound || !sameValue(value, definition.default));

    return (
        <div
            id={`setting-${definition.key}`}
            data-setting-key={definition.key}
            data-highlight={highlight ? "true" : undefined}
            className={cn(
                "border-line -mx-1 rounded-lg border-b px-1 py-4 transition-shadow last:border-b-0",
                "data-[highlight=true]:ring-brand-glow data-[highlight=true]:ring-2"
            )}
        >
            {/* Sized by the space the row actually has, not the viewport: a
                Studio split can be far narrower than the window, and an `md:`
                width pinned the control at 380px inside a 300px pane. Side by
                side while both fit (220 + 24 + 280); stacked below that. The
                control's large grow factor takes it to 380px first, and the
                label keeps the rest. */}
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                <div className="min-w-0 flex-[1_1_220px]">
                    <Label
                        htmlFor={`control-${definition.key}`}
                        className="text-ink text-[13px] font-semibold"
                    >
                        {copy.label}
                    </Label>
                    <p className="text-ink-3 m-0 mt-1 max-w-[560px] text-[12.5px] leading-normal">
                        {copy.description}
                    </p>
                    {copy.consequence && (
                        <p className="text-ink-2 m-0 mt-1.5 flex max-w-[560px] items-start gap-1.5 text-[12px] leading-normal">
                            <span
                                aria-hidden
                                className="bg-warn mt-[5px] inline-block size-1.5 shrink-0 rounded-full"
                            />
                            {copy.consequence}
                        </p>
                    )}
                </div>
                <div className="min-w-0 max-w-[380px] flex-[999_1_280px]">
                    <Control
                        definition={definition}
                        copy={copy}
                        value={value}
                        options={options}
                        disabled={disabled}
                        onChange={commit}
                    />
                    {children}
                </div>
            </div>

            <div className="text-ink-3 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
                <span className="inline-flex items-center gap-1">
                    <Layers size={11} aria-hidden />
                    {provenance.text}
                </span>
                {resolved?.updatedBy && source === resolved.source && source !== "member" && (
                    <SetBy
                        updatedBy={resolved.updatedBy}
                        updatedAt={resolved.updatedAt}
                        folder={folder}
                    />
                )}
                {showReset && (
                    <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-[11.5px]"
                        disabled={saving}
                        onClick={() => void setting.reset(writeScope).catch(() => undefined)}
                    >
                        {provenance.resetLabel}
                    </Button>
                )}
                {saving && <span>{tc("status.saving")}</span>}
                {readOnlyReason && <Badge variant="secondary">{t("readOnly")}</Badge>}
                {readOnlyReason && <span>{readOnlyReason}</span>}
                {saveError && (
                    <span role="alert" className="text-danger">
                        {saveError}
                    </span>
                )}
            </div>
        </div>
    );
}

/**
 * "Set 2 min ago by Ada" — who last changed a shared value, by the name this
 * workspace knows them by. The stored auth id never reaches the page: the
 * viewer is "you", a member is their display name, someone no longer in the
 * workspace is said to have left, and while the lookup is out (or if it
 * fails) the line just says when.
 */
function SetBy({
    updatedBy,
    updatedAt,
    folder,
}: {
    updatedBy: string;
    updatedAt: string | null;
    folder: string | null;
}) {
    const t = useTranslations("settings.row");
    const time = useTimeFormat();
    const viewerId = useSettingsPayload(folder).payload?.viewer?.authUserId ?? null;
    const isViewer = updatedBy === viewerId;
    const person = usePerson(isViewer ? null : updatedBy);
    const when = time.relative(updatedAt);
    return (
        <span>
            {isViewer
                ? t("setByYou", { when })
                : person.status === "member"
                  ? t("setBy", { when, who: person.look.displayName })
                  : person.status === "gone"
                    ? t("setByLeft", { when })
                    : t("setAt", { when })}
        </span>
    );
}

function describeProvenance(
    t: RowT,
    resolved: ReturnType<typeof useSetting>["resolved"],
    /** Where the value this row shows came from, at its write scope. */
    source: SettingScope,
    writeScope: StoredScope,
    folder: string | null
): { text: string; resetLabel: string } {
    if (!resolved) return { text: t("loading"), resetLabel: t("reset") };
    // A member or folder value falls back to the workspace's; the workspace's to the default.
    const resetLabel = writeScope === "workspace" ? t("resetToDefault") : t("resetToWorkspace");
    if (source === writeScope) {
        const where =
            writeScope === "folder"
                ? folder
                    ? t("setOnFolder")
                    : t("setAtFolderLevel")
                : writeScope === "workspace"
                  ? t("setAtWorkspaceLevel")
                  : t("yourChoice");
        return { text: where, resetLabel };
    }
    if (source === "default") {
        return { text: t("defaultNothingSet"), resetLabel: t("reset") };
    }
    const text =
        source === "folder" && resolved.source === "folder" && resolved.sourceId
            ? t("inheritedFromFolder", { folder: resolved.sourceId })
            : source === "folder"
              ? t("inheritedFromThisFolder")
              : source === "workspace"
                ? t("inheritedFromWorkspace")
                : t("inheritedFromYou");
    return { text, resetLabel };
}

function Control({
    definition,
    copy,
    value,
    options,
    disabled,
    onChange,
}: {
    definition: SettingDefinition;
    copy: SettingCopy;
    value: unknown;
    options?: readonly SettingOption[];
    disabled: boolean;
    onChange: (next: unknown) => void;
}) {
    const t = useTranslations("settings.row");
    const tc = useTranslations("common");
    const id = `control-${definition.key}`;
    const control = definition.control;

    switch (control.kind) {
        case "switch":
            return (
                <div className="flex items-center gap-3">
                    <Switch
                        id={id}
                        checked={Boolean(value)}
                        disabled={disabled}
                        onCheckedChange={checked => onChange(checked)}
                        aria-label={copy.label}
                    />
                    <span className="text-ink-2 text-[12.5px]">
                        {value ? tc("status.on") : tc("status.off")}
                    </span>
                </div>
            );
        case "select": {
            const list = options ?? control.options;
            const index = list.findIndex(option => sameValue(option.value, value));
            // A closed menu shows only the label; what the chosen option does
            // (how an answer style answers, say) is said under it.
            const chosen = index >= 0 ? list[index] : undefined;
            const chosenDescription = chosen ? copy.option(chosen).description : undefined;
            const describedBy = chosenDescription ? `${id}-description` : undefined;
            return (
                <div>
                    <Select
                        value={index >= 0 ? String(index) : ""}
                        disabled={disabled}
                        onValueChange={next => {
                            const option = list[Number(next)];
                            if (option) onChange(option.value);
                        }}
                    >
                        <SelectTrigger
                            id={id}
                            className="w-full"
                            aria-label={copy.label}
                            aria-describedby={describedBy}
                        >
                            <SelectValue placeholder={t("choose")} />
                        </SelectTrigger>
                        <SelectContent>
                            {list.map((option, i) => (
                                <SelectItem key={i} value={String(i)}>
                                    {copy.option(option).label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {chosenDescription && (
                        <p
                            id={describedBy}
                            className="text-ink-3 m-0 mt-1.5 text-[12px] leading-normal"
                        >
                            {chosenDescription}
                        </p>
                    )}
                </div>
            );
        }
        case "radio": {
            const list = options ?? control.options;
            const index = list.findIndex(option => sameValue(option.value, value));
            return (
                <RadioGroup
                    value={index >= 0 ? String(index) : ""}
                    disabled={disabled}
                    aria-label={copy.label}
                    onValueChange={next => {
                        const option = list[Number(next)];
                        if (option) onChange(option.value);
                    }}
                    className="gap-1.5"
                >
                    {list.map((option, i) => {
                        const shown = copy.option(option);
                        return (
                            <label
                                key={i}
                                htmlFor={`${id}-${i}`}
                                className={cn(
                                    "border-line flex items-start gap-3 rounded-lg border px-3 py-2",
                                    disabled ? "opacity-70" : "hover:bg-panel-2 cursor-pointer"
                                )}
                            >
                                <RadioGroupItem
                                    id={`${id}-${i}`}
                                    value={String(i)}
                                    className="mt-0.5"
                                />
                                <span>
                                    <span className="text-ink block text-[13px] font-semibold">
                                        {shown.label}
                                    </span>
                                    {shown.description && (
                                        <span className="text-ink-3 block text-[12px] leading-normal">
                                            {shown.description}
                                        </span>
                                    )}
                                </span>
                            </label>
                        );
                    })}
                </RadioGroup>
            );
        }
        case "number":
            return (
                <NumberControl
                    id={id}
                    value={typeof value === "number" ? value : null}
                    min={control.min}
                    max={control.max}
                    step={control.step}
                    unit={copy.unit}
                    disabled={disabled}
                    onCommit={next => onChange(next)}
                />
            );
        case "text":
            return (
                <TextControl
                    id={id}
                    value={typeof value === "string" ? value : ""}
                    placeholder={copy.placeholder}
                    disabled={disabled}
                    onCommit={next => onChange(next)}
                />
            );
    }
}

/** Number and text commit on blur or Enter, never per keystroke — a setting is not a search box. */
function NumberControl({
    id,
    value,
    min,
    max,
    step,
    unit,
    disabled,
    onCommit,
}: {
    id: string;
    value: number | null;
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
    disabled: boolean;
    onCommit: (next: number) => void;
}) {
    const [draft, setDraft] = useState(value === null ? "" : String(value));
    useEffect(() => setDraft(value === null ? "" : String(value)), [value]);
    const commit = () => {
        const parsed = Number(draft);
        if (draft.trim() === "" || !Number.isFinite(parsed)) {
            setDraft(value === null ? "" : String(value));
            return;
        }
        if (parsed !== value) onCommit(parsed);
    };
    return (
        <div className="flex items-center gap-2">
            <Input
                id={id}
                type="number"
                inputMode="decimal"
                value={draft}
                min={min}
                max={max}
                step={step}
                disabled={disabled}
                onChange={e => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={e => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                className="max-w-[200px]"
            />
            {unit && <span className="text-ink-3 text-[12px]">{unit}</span>}
        </div>
    );
}

function TextControl({
    id,
    value,
    placeholder,
    disabled,
    onCommit,
}: {
    id: string;
    value: string;
    placeholder?: string;
    disabled: boolean;
    onCommit: (next: string) => void;
}) {
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    const commit = () => {
        const next = draft.trim();
        if (next !== value) onCommit(next);
    };
    return (
        <Input
            id={id}
            value={draft}
            placeholder={placeholder}
            disabled={disabled}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
        />
    );
}

/** Every generic row a section registers, in registry order. */
export function SectionRows({
    section,
    folder = null,
    optionsFor,
}: {
    section: SettingsSectionId;
    folder?: string | null;
    optionsFor?: (definition: SettingDefinition) => readonly SettingOption[] | undefined;
}) {
    const rows = settingsForSection(section).filter(definition => !definition.custom);
    return (
        <div className="flex flex-col">
            {rows.map(definition => (
                <SettingRow
                    key={definition.key}
                    settingKey={definition.key}
                    folder={folder}
                    options={optionsFor?.(definition)}
                />
            ))}
        </div>
    );
}
