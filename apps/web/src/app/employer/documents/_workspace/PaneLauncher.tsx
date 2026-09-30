"use client";

import { PanelsTopLeft, Plus } from "lucide-react";

import { Button } from "~/components/ui/button";
import type { StudioFeature } from "./types";

export interface PaneLauncherProps {
    title: string;
    hint: string;
    /** The few apps offered up front, already filtered to what this person may open. */
    apps: readonly StudioFeature[];
    onPick: (featureId: string) => void;
    /** The full picker, for everything else. */
    onMore: () => void;
}

/**
 * What an empty pane shows: the whole workspace with nothing open, or a pane
 * just split off. cmux fills a new split with a fresh terminal; there is no
 * one obvious app here, so the pane asks — with the likeliest few a click
 * away and the rest behind "All apps".
 */
export function PaneLauncher({ title, hint, apps, onPick, onMore }: PaneLauncherProps) {
    return (
        <div className="bg-surface text-ink-3 flex flex-1 flex-col items-center justify-center gap-4 overflow-auto p-8 text-center">
            <PanelsTopLeft className="text-ink-3 size-9 shrink-0" strokeWidth={1.25} />
            <div className="space-y-1">
                <h2 className="text-ink text-base font-medium">{title}</h2>
                <p className="max-w-sm text-sm">{hint}</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
                {apps.map(app => (
                    <Button
                        key={app.id}
                        variant="outline"
                        size="sm"
                        title={app.desc}
                        onClick={() => onPick(app.id)}
                    >
                        <app.Icon size={14} />
                        {app.label}
                    </Button>
                ))}
                <Button variant="ghost" size="sm" onClick={onMore}>
                    <Plus className="size-4" />
                    All apps
                </Button>
            </div>
        </div>
    );
}
