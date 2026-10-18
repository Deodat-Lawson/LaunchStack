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

import { ToolLink } from "~/components/tool-app/ToolLink";
import { useOptionalToolNav } from "~/components/tool-app/nav";
import type { SettingDefinition } from "~/lib/settings/registry";
import { SETTINGS_PATH, workspaceHref } from "~/lib/settings/surfaces";
import { settingAtScope, useSetting } from "~/lib/settings/useSettings";

import { SettingRow } from "./SettingRow";

const KEY = "chat.responseStyle";

function styleLabel(definition: SettingDefinition, value: unknown): string {
    const control = definition.control;
    const option =
        control.kind === "select" ? control.options.find(o => o.value === value) : undefined;
    return option?.label ?? String(value);
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
    const { definition, resolved } = useSetting(KEY);
    const workspace = settingAtScope(definition, resolved, "workspace");
    const label = styleLabel(definition, workspace.value);
    const ownChoice = resolved?.stored.member !== undefined;

    let note: ReactNode = null;
    if (resolved?.canEdit.workspace) {
        note = (
            <>
                Everyone who hasn&apos;t picked their own gets the workspace default, {label}.{" "}
                <OtherTabLink href={workspaceHref("agents")}>
                    Change it under Workspace › Agents
                </OtherTabLink>
                .
            </>
        );
    } else if (ownChoice) {
        note = <>The workspace default is {label}.</>;
    }

    return (
        <SettingRow settingKey={KEY} scope="member">
            {note && <Note>{note}</Note>}
        </SettingRow>
    );
}

/** Workspace › Agents: what everyone gets until they pick their own. */
export function WorkspaceAnswerStyleRow() {
    const { definition, resolved } = useSetting(KEY);
    const own = resolved?.stored.member;

    return (
        <SettingRow settingKey={KEY} scope="workspace">
            {own !== undefined && (
                <Note>
                    Your own choice, {styleLabel(definition, own)}, still applies to your chats.{" "}
                    <OtherTabLink href={`${SETTINGS_PATH}#${KEY}`}>
                        Change it under Settings › Appearance
                    </OtherTabLink>
                    .
                </Note>
            )}
        </SettingRow>
    );
}
