"use client";

/**
 * Audit retention — a registry row in the People section, with the same
 * store, audit row and read-only treatment as any other workspace setting.
 * (Whether join links need approval used to sit here too; it is set on each
 * link now, in Invitations.)
 */

import React from "react";
import { useTranslations } from "next-intl";

import { Panel } from "./ui";
import { SettingRow } from "../SettingRow";

export function WorkspaceSettingsCard() {
    const t = useTranslations("settings.people.settingsCard");
    return (
        <Panel className="p-5">
            <div className="mb-2">
                <h2 className="text-ink m-0 text-base font-bold tracking-[-0.01em]">
                    {t("title")}
                </h2>
                <p className="text-ink-3 m-0 mt-1 text-[13px] leading-normal">{t("description")}</p>
            </div>
            <SettingRow settingKey="workspace.auditRetentionDays" />
        </Panel>
    );
}
