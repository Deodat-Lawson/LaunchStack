"use client";

/**
 * Labs — unfinished features, opt-in per workspace.
 *
 * Body only. Each entry is a registry row whose description says honestly
 * what turning it on does today. A lab that does nothing yet does not get an
 * entry: the point of this section is that a switch here always changes
 * something.
 */

import React from "react";
import { useTranslations } from "next-intl";

import { Card, Section } from "~/components/layout/page-shell";

import type { SettingsSectionProps } from "./contract";
import { SectionRows } from "./SettingRow";

export function LabsSection(_: SettingsSectionProps) {
    const t = useTranslations("settings.labs");
    return (
        <Section title={t("title")} description={t("description")}>
            <Card>
                <SectionRows section="labs" />
            </Card>
        </Section>
    );
}
