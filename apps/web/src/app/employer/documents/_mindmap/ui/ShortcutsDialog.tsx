"use client";

import React from "react";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import { ScrollArea } from "~/components/ui/scroll-area";

import { SHORTCUTS } from "./useKeyboard";

/** Generated from the same table the keyboard handler documents itself with. */
export function ShortcutsDialog({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[640px]">
                <DialogHeader>
                    <DialogTitle>Keyboard shortcuts</DialogTitle>
                    <DialogDescription>⌘ is Ctrl on Windows and Linux.</DialogDescription>
                </DialogHeader>
                <ScrollArea className="max-h-[60vh]">
                    <div className="grid grid-cols-1 gap-5 pr-3 sm:grid-cols-2">
                        {SHORTCUTS.map(group => (
                            <section key={group.title}>
                                <h3 className="text-ink-3 mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.08em]">
                                    {group.title}
                                </h3>
                                <dl className="space-y-1">
                                    {group.rows.map(row => (
                                        <div
                                            key={row.keys}
                                            className="flex items-baseline justify-between gap-3"
                                        >
                                            <dt className="text-ink-2 text-[12.5px]">
                                                {row.label}
                                            </dt>
                                            <dd className="border-line bg-panel-2 text-ink-3 shrink-0 rounded border px-1.5 py-0.5 font-mono text-[11px]">
                                                {row.keys}
                                            </dd>
                                        </div>
                                    ))}
                                </dl>
                            </section>
                        ))}
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
}
