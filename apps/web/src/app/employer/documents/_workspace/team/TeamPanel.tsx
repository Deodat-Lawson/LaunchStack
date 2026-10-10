"use client";

/**
 * The Team tab of the rail: People, Groups, Activity (ADR-014).
 * Placeholder until the team layer lands.
 */

import React from "react";

import type { TeamRailProps } from "./types";

export function TeamPanel(_props: TeamRailProps) {
    return (
        <div className="text-ink-3 px-4 py-3 text-[12.5px]" data-testid="team-panel">
            Team
        </div>
    );
}
