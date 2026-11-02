"use client";

import { useId } from "react";
import type { DemoReport, DemoSourceRef } from "../demo-contract";
import { selectWeeklyBrief } from "../_lib/weekly-brief";
import styles from "./weekly-brief.module.css";

export interface WeeklyBriefProps {
    report: DemoReport;
    onSource?: (source: DemoSourceRef) => void;
}

export function WeeklyBrief({ report }: WeeklyBriefProps) {
    const headingId = useId();
    const brief = selectWeeklyBrief(report);
    return (
        <section className={styles.brief} aria-labelledby={headingId}>
            <h2 id={headingId} className={styles.eyebrow}>
                THIS WEEK&apos;S BRIEF
            </h2>
            <p className={styles.preview}>{brief.preview || "No saved summary is available."}</p>
            <details className={styles.disclosure}>
                <summary>
                    Read full brief{" "}
                    <span className={styles.chevron} aria-hidden="true">
                        {"\u2304"}
                    </span>
                </summary>
                <p className={styles.fullBrief}>
                    {brief.fullSummary.trim()
                        ? brief.fullSummary
                        : "No saved summary is available."}
                </p>
            </details>
        </section>
    );
}
