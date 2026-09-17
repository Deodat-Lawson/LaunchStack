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

import { Card, Section } from "~/components/layout/page-shell";

import type { SettingsSectionProps } from "./contract";
import { SectionRows } from "./SettingRow";

export function LabsSection(_: SettingsSectionProps) {
    return (
        <Section
            title="Experiments"
            description="Off by default. On for everyone in the workspace once an admin turns one on."
        >
            <Card>
                <SectionRows section="labs" />
            </Card>
        </Section>
    );
}
