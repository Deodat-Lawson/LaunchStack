import React from "react";
import { Card } from "~/components/ui/card";
import type { LucideIcon } from "lucide-react";
import { cn } from "~/lib/utils";

interface StatsCardProps {
    title: string;
    value: number | string;
    icon: LucideIcon;
    color: "purple" | "blue" | "green" | "amber";
    className?: string;
}

const colorMap = {
    purple: {
        border: "border-l-brand",
        text: "text-brand-ink",
    },
    blue: {
        border: "border-l-blue-500",
        text: "text-blue-500",
    },
    green: {
        border: "border-l-green-500",
        text: "text-green-500",
    },
    amber: {
        border: "border-l-amber-500",
        text: "text-amber-500",
    },
};

export function StatsCard({ title, value, icon: Icon, color, className }: StatsCardProps) {
    const colors = colorMap[color];

    return (
        <Card
            className={cn(
                "bg-panel group flex flex-col justify-between border-l-4 border-none p-5 shadow-sm transition-all hover:shadow-md",
                colors.border,
                className
            )}
        >
            <div className="mb-2 flex items-start justify-between">
                <span className="text-ink-3 text-[10px] font-bold uppercase tracking-widest">
                    {title}
                </span>
                <Icon className={cn("h-4 w-4", colors.text)} />
            </div>
            <div className="text-ink text-3xl font-black">{value}</div>
        </Card>
    );
}
