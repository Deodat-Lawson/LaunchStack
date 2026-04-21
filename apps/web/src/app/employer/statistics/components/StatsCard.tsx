import React from "react";
import { Card } from "~/app/employer/documents/components/ui/card";
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
        border: "border-l-purple-500",
        text: "text-purple-500",
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
        <Card className={cn(
            "p-5 border-none shadow-sm bg-card flex flex-col justify-between group hover:shadow-md transition-all border-l-4",
            colors.border,
            className
        )}>
            <div className="flex justify-between items-start mb-2">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                    {title}
                </span>
                <Icon className={cn("w-4 h-4", colors.text)} />
            </div>
            <div className="text-3xl font-black text-foreground">
                {value}
            </div>
        </Card>
    );
}
