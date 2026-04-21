"use client";

import React from "react";
import { Eye, EyeOff, Users, Lock } from "lucide-react";
import { cn } from "~/lib/utils";
import type { Visibility } from "@launchstack/features/company-metadata";

interface VisibilityBadgeProps {
    visibility: Visibility;
}

const visibilityConfig: Record<Visibility, {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    className: string;
}> = {
    public: {
        label: "Public",
        icon: Eye,
        className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    },
    partner: {
        label: "Partner",
        icon: Users,
        className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    },
    private: {
        label: "Private",
        icon: EyeOff,
        className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    },
    internal: {
        label: "Internal",
        icon: Lock,
        className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    },
};

export function VisibilityBadge({ visibility }: VisibilityBadgeProps) {
    const config = visibilityConfig[visibility];
    const Icon = config.icon;

    return (
        <span className={cn(
            "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold",
            config.className
        )}>
            <Icon className="w-3 h-3" />
            {config.label}
        </span>
    );
}
