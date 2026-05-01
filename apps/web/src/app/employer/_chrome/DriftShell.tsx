"use client";

import type { ReactNode } from "react";

import { AmbientBackground } from "./AmbientBackground";
import { BreadcrumbProvider } from "./BreadcrumbContext";
import styles from "./DriftShell.module.css";

export function DriftShell({ children }: { children: ReactNode }) {
  return (
    <BreadcrumbProvider>
      <div className={styles.app}>
        <AmbientBackground />
        <div className={styles.main}>
          <div className={styles.body}>{children}</div>
        </div>
      </div>
    </BreadcrumbProvider>
  );
}
