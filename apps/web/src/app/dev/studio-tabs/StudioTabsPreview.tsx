"use client";

import { useState } from "react";

import { Button } from "~/components/ui/button";
import { StudioSplitView } from "~/app/employer/documents/_workspace/StudioSplitView";
import type { PaneTab } from "~/app/employer/documents/_workspace/StudioTabs";
import { useStudioLayout } from "~/app/employer/documents/_workspace/paneLayout";
import { STUDIO_FEATURES_BY_ID } from "~/app/employer/documents/_workspace/types";

/**
 * The workspace centre with fabricated panes.
 *
 * The real thing needs a session and a library. This renders the same layout
 * against stubs so columns, drag between columns, keyboard reordering and
 * both themes can be looked at without signing in. Each pane keeps a counter
 * and a draft: neither may reset when the pane is switched away from, nor
 * when it is handed to another column, which is the whole point of the
 * feature and the easiest thing to break.
 */
const PREVIEW_IDS = ["chat", "knowledge", "draft", "rewrite", "notes", "artifacts"];

export function StudioTabsPreview() {
    const { layout, open, openBeside, close, closeOthers, closeToRight, move, split, focusGroup } =
        useStudioLayout();

    const tabFor = (id: string): PaneTab | undefined => STUDIO_FEATURES_BY_ID[id];

    return (
        <div className="bg-surface flex h-screen flex-col">
            <div className="border-line flex flex-wrap items-center gap-2 border-b p-3">
                <span className="text-ink-3 text-xs">Open:</span>
                {PREVIEW_IDS.map(id => (
                    <Button key={id} size="sm" variant="outline" onClick={() => open(id)}>
                        {STUDIO_FEATURES_BY_ID[id]?.label ?? id}
                    </Button>
                ))}
                <span className="text-ink-3 ml-3 text-xs">Beside:</span>
                {PREVIEW_IDS.slice(1, 4).map(id => (
                    <Button
                        key={`beside-${id}`}
                        size="sm"
                        variant="ghost"
                        onClick={() => openBeside(id)}
                    >
                        {STUDIO_FEATURES_BY_ID[id]?.label ?? id}
                    </Button>
                ))}
            </div>
            <StudioSplitView
                layout={layout}
                tabFor={tabFor}
                onSelect={open}
                onClose={close}
                onCloseOthers={closeOthers}
                onCloseToRight={closeToRight}
                onSplit={split}
                onMove={move}
                onFocusGroup={focusGroup}
                onOpenStudio={() => open("chat")}
                emptyState={
                    <div className="text-ink-3 flex flex-1 items-center justify-center text-sm">
                        Nothing open.
                    </div>
                }
                renderPane={id => (
                    <StubPane
                        id={id}
                        visible={layout.groups.some(group => group.activeId === id)}
                        focused={
                            layout.groups.find(group => group.id === layout.activeGroupId)
                                ?.activeId === id
                        }
                    />
                )}
            />
        </div>
    );
}

function StubPane({ id, visible, focused }: { id: string; visible: boolean; focused: boolean }) {
    const [clicks, setClicks] = useState(0);
    const [draft, setDraft] = useState("");

    return (
        <div className="flex h-full flex-col gap-4 overflow-auto p-6">
            <h1 className="text-ink text-lg font-semibold">
                {STUDIO_FEATURES_BY_ID[id]?.label ?? id}
            </h1>
            <p className="text-ink-2 text-sm">
                This pane is{" "}
                <strong>{visible ? (focused ? "focused" : "on screen") : "hidden"}</strong>. Mounted
                panes stay mounted, so the count and the draft below survive a switch and a move to
                another column.
            </p>
            <div className="flex items-center gap-3">
                <Button size="sm" onClick={() => setClicks(c => c + 1)}>
                    Clicked {clicks} times
                </Button>
            </div>
            <textarea
                aria-label={`${id} draft`}
                value={draft}
                onChange={event => setDraft(event.target.value)}
                placeholder="Type here, switch tabs or columns, come back."
                className="border-line bg-panel text-ink min-h-24 max-w-lg rounded-md border p-2 text-sm"
            />
        </div>
    );
}
