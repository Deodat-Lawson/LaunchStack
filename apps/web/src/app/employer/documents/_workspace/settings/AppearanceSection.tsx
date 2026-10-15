"use client";

/**
 * Appearance — theme, density, motion, and how the default assistant answers
 * you. Four rows, on purpose.
 *
 * Body only. Every row is member-scoped. The display rows are applied by
 * `PreferenceSync` (mounted in the employer shell), which is what keeps the
 * theme flash out: next-themes stays the applier, the stored preference is
 * only the memory. The answer style is read by the chat route; its workspace
 * default is set under Agents and autonomy (see `AnswerStyle.tsx`).
 *
 * Mindmap board colours are deliberately absent. Shape colours are document
 * data — a token would repaint someone else's diagram when the *viewer*
 * switched theme. See `_mindmap/README.md`.
 */

import React from "react";

import { Card, Section } from "~/components/layout/page-shell";

import { PersonalAnswerStyleRow } from "./AnswerStyle";
import type { SettingsSectionProps } from "./contract";
import { SectionRows } from "./SettingRow";

export function AppearanceSection(_: SettingsSectionProps) {
    return (
        <>
            <Section
                title="Display"
                description="Applied to this browser as soon as you change it, and remembered for you everywhere you sign in."
            >
                <Card>
                    <SectionRows section="appearance" />
                </Card>
            </Section>
            <Section
                title="Answers"
                description="How Launchstack answers you in chat when no agent is picked. Yours alone: nobody else's answers change."
            >
                <Card>
                    <PersonalAnswerStyleRow />
                </Card>
            </Section>
        </>
    );
}
