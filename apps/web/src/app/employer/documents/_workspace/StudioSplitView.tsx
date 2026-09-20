"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "~/components/ui/resizable";
import { StudioTabs, type PaneTab } from "./StudioTabs";
import { MAX_GROUPS, groupOf, openTabIds, type PaneLayout } from "./paneLayout";

export interface StudioSplitViewProps {
    layout: PaneLayout;
    /** Resolves a tab id to what the strip draws. Unknown ids are dropped. */
    tabFor: (id: string) => PaneTab | undefined;
    /**
     * The pane itself. It takes no "is it active" flag on purpose: with
     * columns there is one visible pane per column and only one focused one,
     * and a single boolean was read as both. The host owns the layout and
     * answers those questions from it.
     */
    renderPane: (id: string) => ReactNode;
    onSelect: (id: string) => void;
    onClose: (groupId: string, id: string) => void;
    onCloseOthers: (groupId: string, id: string) => void;
    onCloseToRight: (groupId: string, id: string) => void;
    onSplit: (id: string) => void;
    onMove: (id: string, toGroupId: string, beforeId: string | null) => void;
    onFocusGroup: (groupId: string) => void;
    onOpenStudio: () => void;
    /** The show-sidebar control, which belongs to the leftmost column only. */
    leadingSlot?: ReactNode;
    /** Shown when nothing at all is open. */
    emptyState: ReactNode;
}

/**
 * The workspace centre: columns side by side, each its own strip of tabs.
 *
 * Panes are NOT rendered inside their column. Each one lives in a container of
 * its own that this component creates once and then moves, with appendChild,
 * into whichever column currently shows it. That looks roundabout and is the
 * point: a pane handed to another column keeps its React state, its scroll
 * position, its focus and its undo history, because neither the React tree
 * above it nor the DOM node under it is ever rebuilt.
 *
 * Portalling straight into the column's own slot would not do. React compares
 * a portal's container when it reconciles, so changing it tears the subtree
 * down and builds a new one — which is exactly the thing tabs exist to avoid.
 */
export function StudioSplitView({
    layout,
    tabFor,
    renderPane,
    onSelect,
    onClose,
    onCloseOthers,
    onCloseToRight,
    onSplit,
    onMove,
    onFocusGroup,
    onOpenStudio,
    leadingSlot,
    emptyState,
}: StudioSplitViewProps) {
    /** Where each column wants its current pane put. */
    const [slots, setSlots] = useState<Record<string, HTMLElement | null>>({});
    /** One stable host node per open tab, created once and reparented after. */
    const hosts = useRef(new Map<string, HTMLDivElement>());

    const registerSlot = useCallback((tabId: string, element: HTMLElement | null) => {
        setSlots(prev => (prev[tabId] === element ? prev : { ...prev, [tabId]: element }));
    }, []);

    const hostFor = (tabId: string) => {
        let host = hosts.current.get(tabId);
        if (!host) {
            host = document.createElement("div");
            host.className = "flex h-full min-h-0 min-w-0 flex-1 flex-col";
            hosts.current.set(tabId, host);
        }
        return host;
    };

    const ids = openTabIds(layout).filter(id => tabFor(id));

    // Move each host under the column showing it, and drop the hosts of tabs
    // that have closed so a reopened tab starts clean rather than resurrected.
    useEffect(() => {
        for (const id of ids) {
            const slot = slots[id];
            const host = hosts.current.get(id);
            if (slot && host && host.parentElement !== slot) slot.appendChild(host);
        }
        const open = new Set(ids);
        for (const [id, host] of hosts.current) {
            if (!open.has(id)) {
                host.remove();
                hosts.current.delete(id);
            }
        }
    });

    const single = layout.groups.length === 1;
    const nothingOpen = single && layout.groups[0]!.tabIds.length === 0;

    return (
        <div className="flex min-h-0 min-w-0 flex-1">
            <ResizablePanelGroup direction="horizontal" className="min-h-0 min-w-0 flex-1">
                {layout.groups.map((group, index) => {
                    const tabs = group.tabIds.flatMap(id => {
                        const tab = tabFor(id);
                        return tab ? [tab] : [];
                    });
                    return [
                        index > 0 ? (
                            <ResizableHandle key={`${group.id}-handle`} withHandle />
                        ) : null,
                        <ResizablePanel
                            key={group.id}
                            id={group.id}
                            order={index}
                            defaultSize={100 / layout.groups.length}
                            minSize={18}
                            className="flex min-h-0 min-w-0 flex-col"
                        >
                            {nothingOpen ? (
                                emptyState
                            ) : (
                                <StudioTabs
                                    groupId={group.id}
                                    index={index}
                                    groupCount={layout.groups.length}
                                    tabs={tabs}
                                    activeId={
                                        tabs.some(tab => tab.id === group.activeId)
                                            ? group.activeId
                                            : (tabs[0]?.id ?? "")
                                    }
                                    focused={group.id === layout.activeGroupId}
                                    canSplit={layout.groups.length < MAX_GROUPS}
                                    onSelect={onSelect}
                                    onClose={id => onClose(group.id, id)}
                                    onCloseOthers={id => onCloseOthers(group.id, id)}
                                    onCloseToRight={id => onCloseToRight(group.id, id)}
                                    onSplit={onSplit}
                                    onMove={onMove}
                                    onOpenStudio={() => {
                                        onFocusGroup(group.id);
                                        onOpenStudio();
                                    }}
                                    onFocus={() => onFocusGroup(group.id)}
                                    leadingSlot={index === 0 ? leadingSlot : undefined}
                                    registerSlot={registerSlot}
                                />
                            )}
                        </ResizablePanel>,
                    ];
                })}
            </ResizablePanelGroup>

            {ids.map(id =>
                createPortal(
                    <div
                        className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
                        // The pane is portalled, so a pointer event in it
                        // reaches this component rather than its column.
                        // Tell the layout which column was touched.
                        onPointerDownCapture={() => {
                            const group = groupOf(layout, id);
                            if (group) onFocusGroup(group.id);
                        }}
                    >
                        {renderPane(id)}
                    </div>,
                    hostFor(id),
                    id
                )
            )}
        </div>
    );
}
