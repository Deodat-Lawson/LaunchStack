"use client";

import React from "react";
import { Globe, FileDown } from "lucide-react";

export function WebsiteSourceTab() {
    return (
        <div className="bg-white dark:bg-slate-900/50 border border-gray-200 dark:border-purple-500/20 rounded-lg p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                    <Globe className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                        Index a Website
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        Web page crawling is coming soon
                    </p>
                </div>
            </div>

            <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                    <Globe className="w-8 h-8 text-gray-300 dark:text-gray-600" />
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
                    Direct URL indexing is under development
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 max-w-md">
                    In the meantime, you can save web pages as PDF or HTML files and
                    upload them via the <strong>Files &amp; Folders</strong> tab. Most browsers
                    support <strong>File &gt; Save As &gt; Web Page (HTML)</strong> or{" "}
                    <strong>Print &gt; Save as PDF</strong>.
                </p>
                <div className="mt-4 flex items-center gap-2 text-xs text-purple-600 dark:text-purple-400">
                    <FileDown className="w-3.5 h-3.5" />
                    <span>Save as PDF or HTML, then upload</span>
                </div>
            </div>
        </div>
    );
}
