"use client";

import React from "react";
import { Brain, Building2 } from "lucide-react";
import styles from "../../../styles/Employer/DocumentViewer.module.css";

export default function LoadingDoc() {
    return (
        <div className={styles.loadingContainer}>
            <aside className={styles.sidebar}>
                <div className={styles.sidebarHeader}>
                    <button className={styles.logoContainer}>
                        <Brain className={styles.logoIcon} />
                        <span className={styles.logoText}>Launchstack</span>
                    </button>
                </div>
                
                <div className="p-6 space-y-4">
                    <div className="h-4 bg-purple-200/50 rounded-lg animate-pulse"></div>
                    <div className="space-y-2">
                        <div className="h-3 bg-gray-200/50 rounded animate-pulse"></div>
                        <div className="h-3 bg-gray-200/50 rounded animate-pulse w-3/4"></div>
                        <div className="h-3 bg-gray-200/50 rounded animate-pulse w-1/2"></div>
                    </div>
                    <div className="space-y-2">
                        <div className="h-3 bg-gray-200/50 rounded animate-pulse"></div>
                        <div className="h-3 bg-gray-200/50 rounded animate-pulse w-2/3"></div>
                    </div>
                </div>
            </aside>

            <main className={styles.mainLoadingContent}>
                <div className={styles.loadingContent}>
                    <div className="relative mb-8">
                        <div className="w-24 h-24 border-4 border-purple-200 rounded-full animate-spin relative">
                            <div className="absolute inset-0 border-4 border-transparent border-t-purple-600 rounded-full animate-spin"></div>
                        </div>
                        <div className="absolute inset-0 flex items-center justify-center">
                            <Building2 className="w-10 h-10 text-purple-600 animate-pulse" />
                        </div>
                    </div>
                    
                    <h2 className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent mb-4">
                        Loading Management Dashboard
                    </h2>
                    
                    <p className="text-gray-600 text-lg mb-8 text-center max-w-md">
                        Preparing your company management tools and document analysis platform
                    </p>
                    
                    <div className="w-64 h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-purple-600 to-indigo-600 rounded-full animate-pulse"></div>
                    </div>
                </div>
            </main>
        </div>
    );
}
