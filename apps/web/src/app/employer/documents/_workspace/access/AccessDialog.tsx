"use client";

/**
 * Kept for the call sites that still say "access": the Share dialog
 * (`./ShareDialog`) is the one component for folders, files and chats.
 */

import React from "react";

import { ShareDialog, type ShareTarget } from "./ShareDialog";

export type AccessTarget = Extract<ShareTarget, { kind: "folder" | "document" }>;

export function AccessDialog({
    target,
    onClose,
    onSaved,
    selfAuthId,
}: {
    target: AccessTarget | null;
    onClose: () => void;
    onSaved?: () => void;
    selfAuthId?: string | null;
}) {
    return (
        <ShareDialog target={target} onClose={onClose} onSaved={onSaved} selfAuthId={selfAuthId} />
    );
}
