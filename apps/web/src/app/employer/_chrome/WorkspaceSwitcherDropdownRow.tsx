"use client";

import { ChevronsRight } from "lucide-react";
import Link from "next/link";

import type { WorkspaceSwitcherPayload } from "./workspaceSwitcherTypes";
import styles from "./WorkspaceSwitcherPill.module.css";

export function WorkspaceSwitcherDropdownRow({
    payload,
    onNavigate,
}: {
    payload: WorkspaceSwitcherPayload;
    onNavigate?: () => void;
}) {
    const swatchClass = styles[`gradient${payload.swatch ?? 1}`] ?? styles.gradient1;

    return (
        <Link
            href="/workspaces"
            className={styles.dropdownRow}
            title={`Switch workspace · ${payload.membershipCount} available`}
            onClick={onNavigate}
        >
            <span className={`${styles.mark} ${swatchClass}`}>{payload.initials}</span>
            <span className={styles.dropdownRowName}>{payload.name}</span>
            <ChevronsRight size={12} className={styles.dropdownRowChevron} aria-hidden="true" />
        </Link>
    );
}
