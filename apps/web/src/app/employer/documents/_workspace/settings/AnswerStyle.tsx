"use client";

/**
 * The default assistant's answer style, drawn twice: once per scope.
 *
 * `chat.responseStyle` is a workspace default with a personal override. The
 * personal row sits under Appearance, where every role can reach it; the
 * workspace row sits under Agents and autonomy, which only admins see. Each
 * row is pinned to its scope (a plain row would write the member value for
 * everyone, admins included) and says what the other scope holds, because
 * the two disagree in exactly the case that confuses people: an admin who
 * changes the default and still gets their own style back.
 */

import React, { type MouseEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";

import type { SettingDefinition } from "~/lib/settings/registry";
import {
    settingAtScope,
    useSetting,
    useSettingCopy,
    type SettingCopy,
} from "~/lib/settings/useSettings";

import { SettingRow } from "./SettingRow";

const KEY = "chat.responseStyle";

function styleLabel(definition: SettingDefinition, copy: SettingCopy, value: unknown): string {
    const control = definition.control;
    const option =
        control.kind === "select" ? control.options.find(o => o.value === value) : undefined;
    return option ? copy.option(option).label : String(value);
}

/**
 * A link to another place in Settings. The hub follows the hash; following
 * the one already in the address bar fires no event, so re-announce it.
 */
function SettingsHashLink({ hash, children }: { hash: string; children: ReactNode }) {
    const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
        if (window.location.hash.replace(/^#/, "") !== hash) return;
        event.preventDefault();
        window.dispatchEvent(new HashChangeEvent("hashchange"));
    };
    return (
        <a href={`#${hash}`} onClick={onClick} className="text-brand-ink underline">
            {children}
        </a>
    );
}

function Note({ children }: { children: ReactNode }) {
    return <p className="text-ink-3 m-0 mt-2 text-[12px] leading-normal">{children}</p>;
}

/** Appearance: this person's own style. Everyone may set it. */
export function PersonalAnswerStyleRow() {
    const t = useTranslations("settings.answerStyle");
    const { definition, resolved } = useSetting(KEY);
    const copy = useSettingCopy(definition);
    const workspace = settingAtScope(definition, resolved, "workspace");
    const label = styleLabel(definition, copy, workspace.value);
    const ownChoice = resolved?.stored.member !== undefined;

    let note: ReactNode = null;
    if (resolved?.canEdit.workspace) {
        note = t.rich("personalNote", {
            label,
            link: chunks => <SettingsHashLink hash="agents">{chunks}</SettingsHashLink>,
        });
    } else if (ownChoice) {
        note = t("workspaceDefault", { label });
    }

    return (
        <SettingRow settingKey={KEY} scope="member">
            {note && <Note>{note}</Note>}
        </SettingRow>
    );
}

/** Agents and autonomy: what everyone gets until they pick their own. */
export function WorkspaceAnswerStyleRow() {
    const t = useTranslations("settings.answerStyle");
    const { definition, resolved } = useSetting(KEY);
    const copy = useSettingCopy(definition);
    const own = resolved?.stored.member;

    return (
        <SettingRow settingKey={KEY} scope="workspace">
            {own !== undefined && (
                <Note>
                    {t.rich("ownChoice", {
                        label: styleLabel(definition, copy, own),
                        link: chunks => <SettingsHashLink hash={KEY}>{chunks}</SettingsHashLink>,
                    })}
                </Note>
            )}
        </SettingRow>
    );
}
