"use client";

/**
 * Models & usage › Models. Placeholder while the screen is built: the
 * server-default overview (`models` settings section).
 */

import React from "react";

import { SettingsSectionView } from "../settings/SectionView";

export function ModelsScreen({ manage }: { manage: boolean }) {
    return manage ? (
        <div data-testid="usage-models" className="flex h-full min-h-0 flex-col">
            <SettingsSectionView id="models" />
        </div>
    ) : (
        <div data-testid="usage-models" />
    );
}
