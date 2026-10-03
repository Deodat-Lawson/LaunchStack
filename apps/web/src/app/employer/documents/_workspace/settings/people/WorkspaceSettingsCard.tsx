"use client";

/**
 * Audit retention — a registry row in the People section, with the same
 * store, audit row and read-only treatment as any other workspace setting.
 * (Whether join links need approval used to sit here too; it is set on each
 * link now, in Invitations.)
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
                    Policy that applies to everyone in this workspace.
                </p>
            </div>
            <SettingRow settingKey="workspace.auditRetentionDays" />
        </Panel>
    );
}
