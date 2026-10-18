import React from "react";
import { MarketingShell } from "./MarketingShell";
import styles from "../../styles/marketing.module.css";

interface LegalPageProps {
    eyebrow: string;
    title: string;
    /** When this page's current text took effect, e.g. "October 17, 2026". */
    effective: string;
    /** One plain-language paragraph shown above the full text. */
    summary: React.ReactNode;
    children: React.ReactNode;
}

/**
 * Shell for the Privacy Policy and Terms of Service: the marketing chrome, a
 * short hero with the effective date, then a single reading column. Google's
 * OAuth brand review fetches these pages, so they must render without
 * JavaScript and without signing in.
 */
export function LegalPage({ eyebrow, title, effective, summary, children }: LegalPageProps) {
    return (
        <MarketingShell>
            <section className={`${styles.pageHero} ${styles.legalHero}`}>
                <div className={styles.eyebrow}>{eyebrow}</div>
                <h1 className={styles.pageTitle}>{title}</h1>
                <p className={styles.legalMeta}>Effective {effective}</p>
            </section>
            <article className={styles.legal}>
                <div className={styles.legalSummary}>{summary}</div>
                {children}
            </article>
        </MarketingShell>
    );
}
