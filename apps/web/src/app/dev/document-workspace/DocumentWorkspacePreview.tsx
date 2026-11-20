"use client";

import { useState } from "react";
import { FileText, MessageSquare } from "lucide-react";
import { DocumentViewer } from "~/app/employer/documents/_workspace/DocumentViewer";
import { StudioSplitView } from "~/app/employer/documents/_workspace/StudioSplitView";
import type { PaneTab } from "~/app/employer/documents/_workspace/StudioTabs";
import { initialLayout, useStudioLayout } from "~/app/employer/documents/_workspace/paneLayout";
import type {
    CitationHighlight,
    PassageSelection,
    WorkspaceSource,
} from "~/app/employer/documents/_workspace/types";

const SOURCE: WorkspaceSource = {
    id: "d9",
    documentId: 9,
    title: "Navigation regression.pdf",
    type: "doc",
    size: "5 pages",
    added: "",
    folder: "Tests",
    tags: [],
    domain: "General",
    indexStatus: "ready",
};
const TABS: Record<string, PaneTab> = {
    "source:d9": { id: "source:d9", label: SOURCE.title, Icon: FileText },
    chat: { id: "chat", label: "Chat", Icon: MessageSquare },
};

/**
 * The real viewer, notes editor and pane host, with the same Ask AI pairing
 * as WorkspaceShell. Browser tests supply session/document API responses;
 * the chat handoff is displayed locally and never sends a model request.
 */
export function DocumentWorkspacePreview() {
    const panes = useStudioLayout(initialLayout(["source:d9", "chat"]));
    const [passage, setPassage] = useState<PassageSelection | null>(null);
    const [citation, setCitation] = useState<CitationHighlight | null>(null);
    const ask = () => panes.pair("source:d9", "chat");

    return (
        <div className="bg-surface flex h-screen flex-col">
            <div className="border-line flex gap-3 border-b p-2">
                <button
                    onClick={() => {
                        panes.merge();
                        panes.open("source:d9");
                    }}
                >
                    Merge panes
                </button>
                <button onClick={() => panes.open("source:d9")}>Show document</button>
                <button
                    onClick={() =>
                        setCitation(previous => ({
                            text: "Annotation target on page 1",
                            page: 1,
                            nonce: (previous?.nonce ?? 0) + 1,
                        }))
                    }
                >
                    Cite first page
                </button>
            </div>
            <StudioSplitView
                layout={panes.layout}
                tabFor={id => TABS[id]}
                onSelect={panes.open}
                onClose={panes.close}
                onCloseOthers={panes.closeOthers}
                onCloseToRight={panes.closeToRight}
                onSplit={panes.split}
                onSplitRoot={panes.splitAtRoot}
                onSplitPane={(group, side) => panes.splitPane(side, group)}
                onCloseGroup={panes.closeGroup}
                onToggleZoom={panes.toggleZoom}
                onResize={panes.resize}
                onMove={panes.move}
                onFocusGroup={panes.focusGroup}
                onOpenStudio={() => panes.open("chat")}
                renderEmpty={() => null}
                renderPane={id =>
                    id === "source:d9" ? (
                        <DocumentViewer
                            source={SOURCE}
                            highlight={citation}
                            onRename={async () => true}
                            onDelete={() => undefined}
                            onRestrictAccess={() => undefined}
                            onAskAbout={ask}
                            onAskAboutPassage={(_source, selection) => {
                                setPassage(selection);
                                ask();
                            }}
                        />
                    ) : (
                        <div className="p-6" data-testid="chat-handoff">
                            <h1>Chat</h1>
                            {passage && (
                                <blockquote data-testid="asked-passage">{passage.text}</blockquote>
                            )}
                            <input aria-label="Question" />
                        </div>
                    )
                }
            />
        </div>
    );
}
