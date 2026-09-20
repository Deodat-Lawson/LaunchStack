"use client";

import type { ReactNode } from "react";

import { AmbientBackground } from "./AmbientBackground";
import { BackBar } from "./BackBar";
import { BreadcrumbProvider } from "./BreadcrumbContext";
import styles from "./DriftShell.module.css";

export function DriftShell({ children }: { children: ReactNode }) {
    return (
        <BreadcrumbProvider>
            <div className={styles.app}>
                <AmbientBackground />
                <div className={styles.main}>
                    {/* In flow, not floating: nearly every screen owns its own
                        top-left corner, so an overlay would land on a rail. */}
                    <BackBar />
                    <div className={styles.body}>{children}</div>
                </div>
            </div>
        </BreadcrumbProvider>
    );
}
