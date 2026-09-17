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
import { PERMISSION_DESCRIPTIONS } from "~/lib/authz/permissions";
import { settingsForSection, type SettingDefinition } from "~/lib/settings/registry";
import type { SettingOption, SettingsSectionId, StoredScope } from "~/lib/settings/types";
import { defaultWriteScope, useSetting } from "~/lib/settings/useSettings";
import { cn } from "~/lib/utils";

import { relativeTime } from "./people/format";

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

const SCOPE_LABEL: Record<StoredScope | "default", string> = {
    default: "Default",
    workspace: "Workspace",
    folder: "This folder",
    member: "You",
};

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
    const setting = useSetting(settingKey, { folder });
    const { definition, resolved, value, loaded, saving, saveError } = setting;
    const writeScope = scope ?? defaultWriteScope(definition, folder);
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

    const permissionReason = !canEdit
        ? definition.permission
            ? `Only people who can ${PERMISSION_DESCRIPTIONS[definition.permission].toLowerCase()} change this.`
            : "Not editable at this scope."
        : null;
    const readOnlyReason = !loaded ? null : (disabledReason ?? permissionReason);

    const provenance = describeProvenance(definition, resolved, writeScope, folder);
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
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                <div className="min-w-[220px] flex-1">
                    <Label
                        htmlFor={`control-${definition.key}`}
                        className="text-ink text-[13px] font-semibold"
                    >
                        {definition.label}
                    </Label>
                    <p className="text-ink-3 m-0 mt-1 max-w-[560px] text-[12.5px] leading-normal">
                        {definition.description}
                    </p>
                    {definition.consequence && (
                        <p className="text-ink-2 m-0 mt-1.5 flex max-w-[560px] items-start gap-1.5 text-[12px] leading-normal">
                            <span
                                aria-hidden
                                className="bg-warn mt-[5px] inline-block size-1.5 shrink-0 rounded-full"
                            />
                            {definition.consequence}
                        </p>
                    )}
                </div>
                <div className="w-full max-w-[380px] shrink-0 md:w-[380px]">
                    <Control
                        definition={definition}
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
                {resolved?.updatedBy && resolved.source !== "member" && (
                    <span>
                        Set {relativeTime(resolved.updatedAt)}
                        {resolved.updatedBy ? ` by ${resolved.updatedBy}` : ""}
                    </span>
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
                {saving && <span>Saving…</span>}
                {readOnlyReason && <Badge variant="secondary">Read-only</Badge>}
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

function describeProvenance(
    definition: SettingDefinition,
    resolved: ReturnType<typeof useSetting>["resolved"],
    writeScope: StoredScope,
    folder: string | null
): { text: string; resetLabel: string } {
    if (!resolved) return { text: "Loading…", resetLabel: "Reset" };
    const inheritsFrom = (): string => {
        if (writeScope === "member") return "the workspace";
        if (writeScope === "folder") return "the workspace";
        return "the default";
    };
    if (resolved.source === writeScope) {
        const where =
            writeScope === "folder" && folder
                ? `Set on this folder`
                : `Set at ${SCOPE_LABEL[writeScope].toLowerCase()} level`;
        return {
            text: writeScope === "member" ? "Your choice" : where,
            resetLabel: `Reset to ${inheritsFrom()}`,
        };
    }
    if (resolved.source === "default") {
        return { text: `${SCOPE_LABEL.default} · nothing set`, resetLabel: "Reset" };
    }
    const from =
        resolved.source === "folder" && resolved.sourceId
            ? `folder “${resolved.sourceId}”`
            : SCOPE_LABEL[resolved.source].toLowerCase();
    return {
        text: `Inherited from ${from}`,
        resetLabel: `Reset to ${inheritsFrom()}`,
    };
}

function Control({
    definition,
    value,
    options,
    disabled,
    onChange,
}: {
    definition: SettingDefinition;
    value: unknown;
    options?: readonly SettingOption[];
    disabled: boolean;
    onChange: (next: unknown) => void;
}) {
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
                        aria-label={definition.label}
                    />
                    <span className="text-ink-2 text-[12.5px]">{value ? "On" : "Off"}</span>
                </div>
            );
        case "select": {
            const list = options ?? control.options;
            const index = list.findIndex(option => sameValue(option.value, value));
            return (
                <Select
                    value={index >= 0 ? String(index) : ""}
                    disabled={disabled}
                    onValueChange={next => {
                        const option = list[Number(next)];
                        if (option) onChange(option.value);
                    }}
                >
                    <SelectTrigger id={id} className="w-full" aria-label={definition.label}>
                        <SelectValue placeholder="Choose…" />
                    </SelectTrigger>
                    <SelectContent>
                        {list.map((option, i) => (
                            <SelectItem key={i} value={String(i)}>
                                {option.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            );
        }
        case "radio": {
            const list = options ?? control.options;
            const index = list.findIndex(option => sameValue(option.value, value));
            return (
                <RadioGroup
                    value={index >= 0 ? String(index) : ""}
                    disabled={disabled}
                    aria-label={definition.label}
                    onValueChange={next => {
                        const option = list[Number(next)];
                        if (option) onChange(option.value);
                    }}
                    className="gap-1.5"
                >
                    {list.map((option, i) => (
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
                                    {option.label}
                                </span>
                                {option.description && (
                                    <span className="text-ink-3 block text-[12px] leading-normal">
                                        {option.description}
                                    </span>
                                )}
                            </span>
                        </label>
                    ))}
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
                    unit={control.unit}
                    disabled={disabled}
                    onCommit={next => onChange(next)}
                />
            );
        case "text":
            return (
                <TextControl
                    id={id}
                    value={typeof value === "string" ? value : ""}
                    placeholder={control.placeholder}
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
