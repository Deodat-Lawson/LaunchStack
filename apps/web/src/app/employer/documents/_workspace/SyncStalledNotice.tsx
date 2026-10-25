"use client";

import { useTranslations } from "next-intl";

import { SYNC_STALL_AFTER_MS } from "./useConnectorSync";

/**
 * Shown when a sync was accepted but no run appeared — the server's
 * background job runner is down or was never configured.
 */
export function SyncStalledNotice() {
    const t = useTranslations("sources.connectorSync");
    const seconds = Math.round(SYNC_STALL_AFTER_MS / 1000);
    return (
        <div
            role="status"
            className="border-line bg-warn-soft text-ink-2 mb-3 rounded-[10px] border px-3.5 py-2.5 text-[12.5px]"
        >
            {t("stalled", { seconds })}
        </div>
    );
}
