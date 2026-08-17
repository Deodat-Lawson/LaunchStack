"use client";

import React from "react";
import { Building2 } from "lucide-react";
import styles from "../../../styles/Employer/DocumentViewer.module.css";
import { LaunchstackMark } from "~/app/_components/LaunchstackLogo";

export default function LoadingDoc() {
    return (
        <div className={styles.loadingContainer}>
            <aside className={styles.sidebar}>
                <div className={styles.sidebarHeader}>
                    <button className={styles.logoContainer}>
                        <LaunchstackMark size={26} title="Launchstack" />
                        <span className={styles.logoText}>Launchstack</span>
                    </button>
                </div>

                <div className="space-y-4 p-6">
                    <div className="bg-brand-soft h-4 animate-pulse rounded-lg"></div>
                    <div className="space-y-2">
                        <div className="h-3 animate-pulse rounded bg-gray-200/50"></div>
                        <div className="h-3 w-3/4 animate-pulse rounded bg-gray-200/50"></div>
                        <div className="h-3 w-1/2 animate-pulse rounded bg-gray-200/50"></div>
                    </div>
                    <div className="space-y-2">
                        <div className="h-3 animate-pulse rounded bg-gray-200/50"></div>
                        <div className="h-3 w-2/3 animate-pulse rounded bg-gray-200/50"></div>
                    </div>
                </div>
            </aside>

            <main className={styles.mainLoadingContent}>
                <div className={styles.loadingContent}>
                    <div className="relative mb-8">
                        <div className="border-brand relative h-24 w-24 animate-spin rounded-full border-4">
                            <div className="border-t-brand absolute inset-0 animate-spin rounded-full border-4 border-transparent"></div>
                        </div>
                        <div className="absolute inset-0 flex items-center justify-center">
                            <Building2 className="text-brand-ink h-10 w-10 animate-pulse" />
                        </div>
                    </div>

                    <h2 className="from-brand to-brand-deep mb-4 bg-gradient-to-r bg-clip-text text-3xl font-bold text-transparent">
                        Loading Management Dashboard
                    </h2>

                    <p className="mb-8 max-w-md text-center text-lg text-gray-600">
                        Preparing your company management tools and document analysis platform
                    </p>

                    <div className="h-2 w-64 overflow-hidden rounded-full bg-gray-200">
                        <div className="from-brand to-brand-deep h-full animate-pulse rounded-full bg-gradient-to-r"></div>
                    </div>
                </div>
            </main>
        </div>
    );
}
