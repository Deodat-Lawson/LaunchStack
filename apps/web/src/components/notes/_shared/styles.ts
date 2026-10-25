import type { CSSProperties, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { createElement } from "react";

export const metaChipStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    padding: "1px 6px",
    borderRadius: 4,
    background: "var(--panel-2)",
    color: "var(--ink-3)",
    fontSize: 10,
    border: "1px solid var(--line-2)",
};

export const iconBtnStyle: CSSProperties = {
    width: 22,
    height: 22,
    borderRadius: 5,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "transparent",
    border: "none",
    color: "var(--ink-3)",
    cursor: "pointer",
};

export interface StatusBadge {
    /** Which badge — the label is `notes.card.status.<status>`. */
    status: "drifted" | "orphaned";
    color: string;
    bg: string;
    icon: ReactNode;
}

export function statusBadge(status: string | null | undefined): StatusBadge | null {
    if (status === "drifted")
        return {
            status: "drifted",
            color: "oklch(0.5 0.18 70)",
            bg: "oklch(0.96 0.06 70)",
            icon: createElement(AlertTriangle, { size: 10 }),
        };
    if (status === "orphaned")
        return {
            status: "orphaned",
            color: "oklch(0.5 0.2 30)",
            bg: "oklch(0.96 0.04 30)",
            icon: createElement(AlertTriangle, { size: 10 }),
        };
    return null;
}
