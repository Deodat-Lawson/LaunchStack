"use client";

import { useMemo } from "react";
import { Sparkles } from "lucide-react";

import { ContextTarget } from "~/components/context-menu";
import { Button } from "~/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { cn } from "~/lib/utils";
import { usePermissions } from "~/lib/use-permissions";
import { STUDIO_GROUPS } from "./types";

export interface StudioDrawerProps {
    open: boolean;
    onClose: () => void;
    /** Open the app, in a tab or by navigating — the shell decides which. */
    onPickFeature: (featureId: string) => void;
    /** The app showing right now, marked in the picker. */
    activeFeatureId?: string;
}

/**
 * Studio's app picker.
 *
 * It used to host the panes itself, beside a rail, with an Expand button that
 * promoted one into the workspace. Apps live in tabs now and stay mounted, so
 * there is nothing left to expand: this picks one and gets out of the way.
 */
export function StudioDrawer({ open, onClose, onPickFeature, activeFeatureId }: StudioDrawerProps) {
    // Fails closed: until permissions have loaded, gated entries are absent.
    const { can } = usePermissions();
    const visibleGroups = useMemo(
        () =>
            STUDIO_GROUPS.map(group => ({
                ...group,
                features: group.features.filter(feature => can(feature.requires)),
            })).filter(group => group.features.length > 0),
        [can]
    );

    const pickFeature = (featureId: string) => {
        onPickFeature(featureId);
        onClose();
    };

    return (
        <Dialog
            open={open}
            onOpenChange={nextOpen => {
                if (!nextOpen) onClose();
            }}
        >
            <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl">
                <DialogHeader className="border-line px-5 pb-4 pr-12 pt-5">
                    <DialogTitle className="flex items-center gap-2 text-base">
                        <span className="bg-brand-soft text-brand flex size-8 items-center justify-center rounded-lg">
                            <Sparkles className="size-4" aria-hidden />
                        </span>
                        Studio apps
                    </DialogTitle>
                    <DialogDescription>
                        Open a workspace app. Your access decides which apps are listed.
                    </DialogDescription>
                </DialogHeader>

                <div className="max-h-[70vh] overflow-y-auto px-5 pb-5">
                    {visibleGroups.map(group => (
                        <section key={group.id} className="mt-5 first:mt-1">
                            <h2 className="text-ink-3 mb-2 px-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                                {group.label}
                            </h2>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {group.features.map(feature => {
                                    const Icon = feature.Icon;
                                    const isActive = feature.id === activeFeatureId;
                                    const isComing = feature.comingSoon === true;

                                    return (
                                        <ContextTarget
                                            key={feature.id}
                                            target={{
                                                kind: "studio-feature",
                                                id: feature.id,
                                                label: `Actions for ${feature.label}`,
                                                data: feature,
                                                items: () => [
                                                    {
                                                        type: "item",
                                                        id: "open",
                                                        label: "Open",
                                                        icon: "open",
                                                        disabled: isComing,
                                                        disabledReason: isComing
                                                            ? "Coming soon."
                                                            : undefined,
                                                        onSelect: () => pickFeature(feature.id),
                                                    },
                                                    ...(feature.href
                                                        ? [
                                                              {
                                                                  type: "item" as const,
                                                                  id: "open-tab",
                                                                  label: "Open in a new tab",
                                                                  icon: "external" as const,
                                                                  onSelect: () =>
                                                                      window.open(
                                                                          feature.href,
                                                                          "_blank",
                                                                          "noopener,noreferrer"
                                                                      ),
                                                              },
                                                          ]
                                                        : []),
                                                ],
                                            }}
                                        >
                                            <Button
                                                type="button"
                                                variant="outline"
                                                aria-current={isActive ? "page" : undefined}
                                                onClick={() => pickFeature(feature.id)}
                                                className={cn(
                                                    "border-line bg-panel hover:border-brand hover:bg-brand-soft h-auto min-h-[76px] w-full items-start gap-3 rounded-lg px-3 py-3 text-left font-normal shadow-none transition-colors",
                                                    isActive && "border-brand bg-brand-soft"
                                                )}
                                            >
                                                <span
                                                    aria-hidden
                                                    className={cn(
                                                        "bg-panel-2 text-ink-2 mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md",
                                                        isActive && "bg-panel text-brand"
                                                    )}
                                                >
                                                    <Icon size={16} />
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="text-ink flex items-center gap-2 text-[13px] font-semibold leading-snug">
                                                        <span className="truncate">
                                                            {feature.label}
                                                        </span>
                                                        {isComing && (
                                                            <span
                                                                title="Coming soon"
                                                                className="bg-panel-2 text-ink-3 shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide"
                                                            >
                                                                SOON
                                                            </span>
                                                        )}
                                                    </span>
                                                    <span className="text-ink-3 mt-1 line-clamp-2 whitespace-normal text-[11px] leading-snug">
                                                        {feature.desc}
                                                    </span>
                                                </span>
                                            </Button>
                                        </ContextTarget>
                                    );
                                })}
                            </div>
                        </section>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    );
}
