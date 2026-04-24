"use client";

import { type ReactNode } from "react";
import styles from "./legalGenerator.module.css";

export { styles as legalTheme };

interface LegalGeneratorThemeProps {
  children: ReactNode;
  /** When true, renders the ambient orb background. Default true. */
  ambient?: boolean;
  className?: string;
}

/**
 * Scoped theme wrapper — exposes marketing/landing design tokens as CSS
 * variables (`--accent`, `--panel`, `--ink`, …) and paints the ambient
 * orb background, so the Legal Document Generator feels like the same
 * product as the chat and landing page.
 */
export function LegalGeneratorTheme({
  children,
  ambient = true,
  className,
}: LegalGeneratorThemeProps) {
  return (
    <div className={`${styles.root}${className ? ` ${className}` : ""}`}>
      {ambient && (
        <div aria-hidden className={styles.ambient}>
          <div className={`${styles.orb} ${styles.orb1}`} />
          <div className={`${styles.orb} ${styles.orb2}`} />
          <div className={`${styles.orb} ${styles.orb3}`} />
          <div className={styles.dots} />
        </div>
      )}
      <div className={styles.content}>{children}</div>
    </div>
  );
}
