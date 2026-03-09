"use client";

import React from "react";
import { Pin } from "lucide-react";
import type { Priority } from "~/lib/tools/company-metadata/types";

interface PriorityBadgeProps {
    priority: Priority;
}

export function PriorityBadge({ priority }: PriorityBadgeProps) {
    if (priority !== "manual_override") return null;

    return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">
            <Pin className="w-3 h-3" />
            Manual
        </span>
    );
}
