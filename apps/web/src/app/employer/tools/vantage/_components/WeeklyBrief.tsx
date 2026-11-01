"use client";

import { useId } from "react";
import type { DemoReport, DemoSourceRef } from "../demo-contract";
import { selectWeeklyBrief } from "../_lib/weekly-brief";
import styles from "./weekly-brief.module.css";

export interface WeeklyBriefProps {
    report: DemoReport;
    onSource?: (source: DemoSourceRef) => void;
}

export function WeeklyBrief({ report, onSource }: WeeklyBriefProps) {
    const headingId = useId();
    const brief = selectWeeklyBrief(report);
    return (
        <section className={styles.brief} aria-labelledby={headingId}>
            <p className={styles.eyebrow}>
                <span aria-hidden="true">✧</span> This week&apos;s brief
            </p>
            <h2 id={headingId} className={styles.headline}>
                {brief.headline}
            </h2>
            <div className={styles.preview}>
                {brief.previewLabel ? (
                    <p className={styles.previewLabel}>
                        {brief.previewLabel === "Reported conflict"
                            ? "Reported differences"
                            : brief.previewLabel}
                    </p>
                ) : null}
                <p>{brief.preview}</p>
            </div>
            {brief.highlight ? (
                <aside className={styles.highlight} aria-label="Also recorded">
                    <p className={styles.highlightLabel}>
                        Also recorded{brief.highlight.unreviewed ? " - unreviewed source" : ""}
                    </p>
                    <p className={styles.original}>{brief.highlight.text}</p>
                    <div className={styles.sources}>
                        {brief.highlight.refs.map((ref, index) => {
                            const label =
                                report.diagnostics.sources.find(
                                    item =>
                                        item.source.kind === ref.kind &&
                                        item.source.id === ref.id &&
                                        item.source.version === ref.version
                                )?.title ?? `${ref.kind}:${ref.id}`;
                            return onSource ? (
                                <button type="button" key={index} onClick={() => onSource(ref)}>
                                    {label} <span className={styles.version}>(v{ref.version})</span>
                                </button>
                            ) : (
                                <span key={index}>
                                    {label} (v{ref.version})
                                </span>
                            );
                        })}
                    </div>
                </aside>
            ) : null}
            <details className={styles.disclosure}>
                <summary>
                    Read full brief{" "}
                    <span className={styles.chevron} aria-hidden="true">
                        ⌄
                    </span>
                </summary>
                <div className={styles.fullBrief}>
                    <h3>Stored report summary</h3>
                    <p className={styles.original}>
                        {brief.fullSummary.trim() ? brief.fullSummary : "No summary was supplied."}
                    </p>
                    {brief.unknowns.length > 0 ? (
                        <div className={styles.evidence}>
                            <h3>Open questions from the report</h3>
                            <ul>
                                {brief.unknowns.map((text, index) => (
                                    <li className={styles.original} key={index}>
                                        {text}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : null}
                    {brief.evidence.length > 0 ? (
                        <div className={styles.evidence}>
                            <h3>Reported evidence</h3>
                            <ul>
                                {brief.evidence.map((fact, index) => (
                                    <li key={index}>
                                        <p className={styles.original}>{fact.text}</p>
                                        {onSource && fact.refs.length > 0 ? (
                                            <div className={styles.sources}>
                                                {fact.refs.map((ref, refIndex) => (
                                                    <button
                                                        type="button"
                                                        key={refIndex}
                                                        onClick={() => onSource(ref)}
                                                    >
                                                        {report.diagnostics.sources.find(
                                                            item =>
                                                                item.source.kind === ref.kind &&
                                                                item.source.id === ref.id &&
                                                                item.source.version === ref.version
                                                        )?.title ?? `${ref.kind}:${ref.id}`}{" "}
                                                        <span className={styles.version}>
                                                            (v{ref.version})
                                                        </span>
                                                    </button>
                                                ))}
                                            </div>
                                        ) : null}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : null}
                </div>
            </details>
        </section>
    );
}
