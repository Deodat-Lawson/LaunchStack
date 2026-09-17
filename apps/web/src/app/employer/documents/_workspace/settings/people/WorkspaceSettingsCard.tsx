"use client";

/**
 * Join policy and audit retention — two registry rows in the People section.
 *
 * They used to be a form of their own with a second Save button and a second
 * fetch. Now they are rows like any other workspace setting: same store,
 * same audit row, same read-only treatment for people without
 * `settings.manage`, and findable from the palette by name.
 */

import React from "react";

import { Panel } from "./ui";
import { SettingRow } from "../SettingRow";

export function WorkspaceSettingsCard() {
    return (
        <Panel className="p-5">
            <div className="mb-2">
                <h2 className="text-ink m-0 text-base font-bold tracking-[-0.01em]">
                    Workspace settings
                </h2>
                <p className="text-ink-3 m-0 mt-1 text-[13px] leading-normal">
                    How people get in, and how long the audit log is kept.
                </p>
            </div>
            <SettingRow settingKey="workspace.joinPolicy" />
            <SettingRow settingKey="workspace.auditRetentionDays" />
        </Panel>
    );
}
