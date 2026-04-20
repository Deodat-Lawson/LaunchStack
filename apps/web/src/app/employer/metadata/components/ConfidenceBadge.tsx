"use client";

import React from "react";
import { cn } from "~/lib/utils";

interface ConfidenceBadgeProps {
    confidence: number;
    showLabel?: boolean;
}

export function ConfidenceBadge({ confidence, showLabel = false }: ConfidenceBadgeProps) {
    const percentage = Math.round(confidence * 100);

    let colorClass: string;
    let bgClass: string;

    if (percentage >= 80) {
        colorClass = "text-green-700 dark:text-green-400";
        bgClass = "bg-green-100 dark:bg-green-900/30";
    } else if (percentage >= 60) {
        colorClass = "text-amber-700 dark:text-amber-400";
        bgClass = "bg-amber-100 dark:bg-amber-900/30";
    } else {
        colorClass = "text-red-700 dark:text-red-400";
        bgClass = "bg-red-100 dark:bg-red-900/30";
    }

    return (
        <span className={cn(
            "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold",
            bgClass,
            colorClass
        )}>
            {percentage}%
            {showLabel && " confidence"}
        </span>
    );
}
