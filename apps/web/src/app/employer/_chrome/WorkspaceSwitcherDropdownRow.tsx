"use client";

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
  const swatchClass =
    styles[`gradient${payload.swatch ?? 1}`] ?? styles.gradient1;

  return (
    <Link
      href="/workspaces"
      className={styles.dropdownRow}
      title={`Switch workspace · ${payload.membershipCount} available`}
      onClick={onNavigate}
    >
      <span className={`${styles.mark} ${swatchClass}`}>{payload.initials}</span>
      <span className={styles.dropdownRowName}>{payload.name}</span>
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={styles.dropdownRowChevron}
        aria-hidden="true"
      >
        <polyline points="8 18 14 12 8 6" />
        <polyline points="13 18 19 12 13 6" />
      </svg>
    </Link>
  );
}
