"use client";

/**
 * Appearance — theme, density, motion. Three rows, on purpose.
 *
 * Body only. Every row is member-scoped and applied by `PreferenceSync`
 * (mounted in the employer shell), which is what keeps the theme flash out:
 * next-themes stays the applier, the stored preference is only the memory.
 *
 * Mindmap board colours are deliberately absent. Shape colours are document
 * data — a token would repaint someone else's diagram when the *viewer*
 * switched theme. See `_mindmap/README.md`.
 */

import React from "react";

import { Card, Section } from "~/components/layout/page-shell";

import type { SettingsSectionProps } from "./contract";
import { SectionRows } from "./SettingRow";

export function AppearanceSection(_: SettingsSectionProps) {
    return (
        <Section
            title="Display"
            description="Applied to this browser as soon as you change it, and remembered for you everywhere you sign in."
        >
            <Card>
                <SectionRows section="appearance" />
            </Card>
        </Section>
    );
}
