"use client";

/**
 * Shortcuts — every command, its keys, and a way to change them.
 *
 * Body only. The list is the registry in `~/lib/shortcuts/commands`; the
 * member's overrides are one registry setting (`shortcuts.bindings`). Click
 * a binding to record a new one: the next key combination pressed becomes
 * it, Escape cancels, Backspace unbinds. Conflicts are shown, not forbidden —
 * the last-declared command wins, as in T3 Code, and the row says so.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, Section } from "~/components/layout/page-shell";
import {
    SHORTCUT_COMMANDS,
    canonicalKeys,
    findConflicts,
    formatKeys,
    keysFromEvent,
    resolveBindings,
    shortcutDescription,
    shortcutLabel,
    type ShortcutBindings,
} from "~/lib/shortcuts/commands";
import { useSetting } from "~/lib/settings/useSettings";
import { cn } from "~/lib/utils";

import { usePublishedActions, type SettingsSectionProps } from "./contract";
import { StatusNote } from "./ui";

export function ShortcutsSection({ onActions }: SettingsSectionProps) {
    const t = useTranslations("settings.shortcuts");
    const ts = useTranslations("shortcuts");
    const setting = useSetting<ShortcutBindings>("shortcuts.bindings");
    const storedOverrides = setting.value;
    const overrides = useMemo<ShortcutBindings>(() => storedOverrides ?? {}, [storedOverrides]);
    const bindings = useMemo(() => resolveBindings(overrides), [overrides]);
    const conflicts = useMemo(() => findConflicts(bindings), [bindings]);
    const [recording, setRecording] = useState<string | null>(null);
    const customised = Object.keys(overrides).length;

    const save = useCallback(
        (next: ShortcutBindings) => {
            void setting.set(next, "member").catch(() => undefined);
        },
        [setting]
    );

    usePublishedActions(
        onActions,
        {
            primaryLabel: t("resetAll"),
            primaryBusyLabel: t("resetting"),
            onPrimary: () => setting.reset("member"),
            busy: setting.saving,
            disabled: customised === 0,
        },
        [customised, setting.saving, setting.reset, t]
    );

    // While recording, the next chord becomes the binding. Escape cancels;
    // Backspace or Delete unbinds.
    useEffect(() => {
        if (!recording) return;
        const onKey = (event: KeyboardEvent) => {
            event.preventDefault();
            event.stopPropagation();
            if (event.key === "Escape") {
                setRecording(null);
                return;
            }
            if (event.key === "Backspace" || event.key === "Delete") {
                save({ ...overrides, [recording]: null });
                setRecording(null);
                return;
            }
            const keys = keysFromEvent(event);
            if (!keys) return;
            const command = SHORTCUT_COMMANDS.find(c => c.id === recording);
            const next = { ...overrides };
            if (command && canonicalKeys(command.defaultKeys) === keys) delete next[recording];
            else next[recording] = keys;
            save(next);
            setRecording(null);
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [recording, overrides, save]);

    return (
        <>
            {setting.saveError && <StatusNote tone="danger">{setting.saveError}</StatusNote>}
            {conflicts.size > 0 && (
                <StatusNote tone="warn">{t("conflicts", { count: conflicts.size })}</StatusNote>
            )}

            <Section title={t("commands.title")} description={t("commands.description")}>
                <Card padding={0}>
                    {SHORTCUT_COMMANDS.map((command, index) => {
                        const keys = bindings.get(command.id) ?? null;
                        const isRecording = recording === command.id;
                        const isCustom = command.id in overrides;
                        const conflict = keys ? conflicts.get(keys) : undefined;
                        const label = shortcutLabel(ts, command);
                        return (
                            <div
                                key={command.id}
                                className={cn(
                                    "flex items-center gap-4 px-5 py-3",
                                    index > 0 && "border-line border-t"
                                )}
                            >
                                <div className="min-w-0 flex-1">
                                    <div className="text-ink text-[13px] font-semibold">
                                        {label}
                                    </div>
                                    <div className="text-ink-3 text-[12px]">
                                        {shortcutDescription(ts, command)}
                                    </div>
                                    {conflict && conflict.length > 1 && (
                                        <div className="text-ink-2 mt-0.5 text-[11.5px]">
                                            {t("sharedWith", {
                                                list: conflict
                                                    .filter(id => id !== command.id)
                                                    .map(id => {
                                                        const other = SHORTCUT_COMMANDS.find(
                                                            c => c.id === id
                                                        );
                                                        return other
                                                            ? shortcutLabel(ts, other)
                                                            : id;
                                                    })
                                                    .join(t("listSeparator")),
                                            })}
                                        </div>
                                    )}
                                </div>
                                {isCustom && <Badge variant="secondary">{t("custom")}</Badge>}
                                {command.when === "outside-input" && (
                                    <span className="text-ink-3 text-[11px]">
                                        {t("notWhileTyping")}
                                    </span>
                                )}
                                <button
                                    type="button"
                                    onClick={() => setRecording(isRecording ? null : command.id)}
                                    aria-label={t("changeFor", { command: label })}
                                    className={cn(
                                        "mono min-w-[96px] rounded-md border px-2.5 py-1.5 text-center text-[12px]",
                                        isRecording
                                            ? "border-brand bg-brand-soft text-brand-ink"
                                            : "border-line bg-panel-2 text-ink hover:border-brand"
                                    )}
                                >
                                    {isRecording
                                        ? t("pressKeys")
                                        : keys
                                          ? formatKeys(keys)
                                          : t("unbound")}
                                </button>
                                {isCustom && !isRecording && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                            const next = { ...overrides };
                                            delete next[command.id];
                                            save(next);
                                        }}
                                    >
                                        {t("default")}
                                    </Button>
                                )}
                            </div>
                        );
                    })}
                </Card>
            </Section>

            <Section title={t("elsewhere.title")} description={t("elsewhere.description")}>
                <Card>
                    <div className="text-ink-2 text-[13px] leading-relaxed">
                        {t("elsewhere.body")}
                    </div>
                </Card>
            </Section>
        </>
    );
}
