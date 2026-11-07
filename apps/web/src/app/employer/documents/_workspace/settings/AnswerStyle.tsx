"use client";

/**
 * The default assistant's answer style, drawn twice: once per scope.
 *
 * `chat.responseStyle` is a workspace default with a personal override. The
 * personal row sits under Settings › Appearance, where every role can reach
 * it; the workspace row sits under Workspace › Agents, which only admins see.
 * Each row is pinned to its scope (a plain row would write the member value
 * for everyone, admins included) and says what the other scope holds,
 * because the two disagree in exactly the case that confuses people: an
 * admin who changes the default and still gets their own style back.
 */

import React, { type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { ToolLink } from "~/components/tool-app/ToolLink";
import { useOptionalToolNav } from "~/components/tool-app/nav";
import type { SettingDefinition } from "~/lib/settings/registry";
import { SETTINGS_PATH, workspaceHref } from "~/lib/settings/surfaces";
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
 * A link from one tab's row to the other's: Settings and the Workspace tab
 * are tabs of the workspace, so inside a tool's tab the link is handed to the
 * workspace (`ToolLink`), and from Settings it is an ordinary link the shell
 * opens in place.
 */
function OtherTabLink({ href, children }: { href: string; children: ReactNode }) {
    const inTool = useOptionalToolNav() !== null;
    const className = "text-brand-ink underline";
    return inTool ? (
        <ToolLink href={href} className={className}>
            {children}
        </ToolLink>
    ) : (
        <Link href={href} className={className}>
            {children}
        </Link>
    );
}

function Note({ children }: { children: ReactNode }) {
    return <p className="text-ink-3 m-0 mt-2 text-[12px] leading-normal">{children}</p>;
}

/** Settings › Appearance: this person's own style. Everyone may set it. */
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
            link: chunks => <OtherTabLink href={workspaceHref("agents")}>{chunks}</OtherTabLink>,
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

/** Workspace › Agents: what everyone gets until they pick their own. */
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
                        link: chunks => (
                            <OtherTabLink href={`${SETTINGS_PATH}#${KEY}`}>{chunks}</OtherTabLink>
                        ),
                    })}
                </Note>
            )}
        </SettingRow>
    );
}
