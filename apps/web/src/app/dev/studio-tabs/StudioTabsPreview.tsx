"use client";

import { useState } from "react";

import { Button } from "~/components/ui/button";
import { StudioTabs, useStudioTabs } from "~/app/employer/documents/_workspace/StudioTabs";
import { STUDIO_FEATURES_BY_ID } from "~/app/employer/documents/_workspace/types";

/**
 * The workspace tab strip with fabricated panes.
 *
 * The real strip lives above the Studio apps, which need a session and a
 * library. This renders the same component against stub panes so drag and
 * keyboard reordering, closing, the empty state and both themes can be looked
 * at without signing in. Each pane keeps a counter and a text field: switching
 * tabs must not reset either, which is the whole reason the strip exists.
 */
const PREVIEW_IDS = ["chat", "knowledge", "draft", "rewrite", "notes", "artifacts"];

export function StudioTabsPreview() {
    const { ids, activeId, open, close, move } = useStudioTabs();
    const features = ids.flatMap(id => {
        const feature = STUDIO_FEATURES_BY_ID[id];
        return feature ? [feature] : [];
    });

    return (
        <div className="bg-surface flex h-screen flex-col">
            <div className="border-line flex flex-wrap items-center gap-2 border-b p-3">
                <span className="text-ink-3 text-xs">Open:</span>
                {PREVIEW_IDS.map(id => (
                    <Button key={id} size="sm" variant="outline" onClick={() => open(id)}>
                        {STUDIO_FEATURES_BY_ID[id]?.label ?? id}
                    </Button>
                ))}
            </div>
            <div className="flex min-h-0 flex-1">
                <StudioTabs
                    features={features}
                    activeId={activeId}
                    onSelect={open}
                    onClose={close}
                    onMove={move}
                    onOpenStudio={() => open("chat")}
                >
                    {(id, active) => <StubPane id={id} active={active} />}
                </StudioTabs>
            </div>
        </div>
    );
}

function StubPane({ id, active }: { id: string; active: boolean }) {
    const [clicks, setClicks] = useState(0);
    const [draft, setDraft] = useState("");

    return (
        <div className="flex h-full flex-col gap-4 overflow-auto p-6">
            <h1 className="text-ink text-lg font-semibold">
                {STUDIO_FEATURES_BY_ID[id]?.label ?? id}
            </h1>
            <p className="text-ink-2 text-sm">
                This pane reports itself as <strong>{active ? "on screen" : "hidden"}</strong>.
                Mounted panes stay mounted, so the count and the draft below survive a switch.
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
                placeholder="Type here, switch tabs, come back."
                className="border-line bg-panel text-ink min-h-24 max-w-lg rounded-md border p-2 text-sm"
            />
        </div>
    );
}
