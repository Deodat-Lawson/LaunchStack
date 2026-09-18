"use client";

import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
} from "react";
import {
    ChevronLeft,
    ChevronRight,
    History as HistoryIcon,
    Layers,
    MessageSquare,
    Shapes,
    X,
} from "lucide-react";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "~/components/ui/resizable";
import { TooltipProvider } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

import { toast } from "sonner";

import { defaultChromeDepth, readChromeDepth, writeChromeDepth } from "../lib/preferences";
import {
    docMode,
    pauseAutoArrangeAfterManualMove,
    setActivePage,
    setAutoLayout,
    viewportCentre,
} from "../model/commands";
import { createNodeAt } from "../model/factory";
import { isImageFile } from "../lib/images";
import { shapeHoldsText } from "../model/shapes";
import { parseDoc } from "../model/serialize";
import { EditorStore, type ChromeDepth, type EditorState } from "../model/store";
import type { Point, ShapeId } from "../model/types";
import { BottomBar } from "./BottomBar";
import { Canvas } from "./Canvas";
import { useContextTarget } from "~/components/context-menu";
import { buildCanvasMenuItems } from "./canvasContextMenu";
import { buildCommands, CommandPalette } from "./CommandPalette";
import { CommentsPanel } from "./CommentsPanel";
import { EditorProvider, useCommittedDoc, useEditor } from "./EditorContext";
import { ExportDialog, ImportDialog } from "./ExportDialog";
import { FindBar } from "./FindBar";
import { HistoryPanel } from "./HistoryPanel";
import { Inspector } from "./Inspector";
import { OutlinePanel } from "./OutlinePanel";
import { StaleBanner } from "./PresenceLayer";
import { PublishDialog } from "./PublishDialog";
import { ShapePalette } from "./ShapePalette";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { TextEditorOverlay } from "./TextEditorOverlay";
import { EmptyCanvasHint } from "./EmptyCanvasHint";
import { Presenter } from "./Presenter";
import { SelectionToolbar } from "./SelectionToolbar";
import { Toolbar } from "./Toolbar";
import { TopBar } from "./TopBar";
import { useAutoFit } from "./useAutoFit";
import { useAutosave } from "./useAutosave";
import { importDocumentFile, insertImages, useClipboardPaste } from "./useClipboardPaste";
import { useElementSize } from "./useElementSize";
import { useKeyboard } from "./useKeyboard";
import { usePresence } from "./usePresence";

/**
 * The editor shell.
 *
 * Owns the store, the panel layout and every dialog. Each piece below talks to
 * the store rather than to its siblings, so the shell stays a layout file: no
 * document logic lives here.
 */

const selectDirty = (s: EditorState) => s.dirty;

export interface MindmapEditorProps {
    mindmapId: number;
    initialDoc: unknown;
    initialTitle: string;
    initialRevision: number;
    folder: string;
    publishedDocumentId: number | null;
    /**
     * The document was just built from a template and has never been stored;
     * persist it on mount so the map survives being closed straight away.
     */
    needsInitialSave?: boolean;
    /** Display name used as the author on new comments. */
    author: string;
    /**
     * Prototype of the disclosure plan. `focus` opens with no side panels,
     * five tools and a toolbar on the selection; unset keeps today's editor.
     */
    initialChrome?: ChromeDepth;
    /**
     * Where the top bar's back arrow goes. The workspace mounts the editor
     * in place and hands it "return to the preview"; the standalone route
     * leaves it unset and gets a link to the library.
     */
    onBack?: () => void;
    /**
     * "Ask about this in chat" on a topic. The workspace wires it to the
     * composer; the standalone route leaves it unset and the verb is absent.
     */
    onAskAboutNode?: (text: string) => void;
}

type LeftTab = "shapes" | "outline" | "comments" | "history";

export function MindmapEditor(props: MindmapEditorProps) {
    // One store per mounted document. `useState` with an initialiser rather
    // than `useMemo`, because a store is state, not a derived value.
    const [store] = useState(() => {
        const created = new EditorStore(parseDoc(props.initialDoc, props.initialTitle));
        // How much chrome to open with: an explicit request, else what this
        // person last chose for this kind of diagram, else the kind's default.
        const kind = created.getState().doc.settings.kind;
        created.setChromeDepth(
            props.initialChrome ?? readChromeDepth(kind) ?? defaultChromeDepth(kind)
        );
        return created;
    });

    const stageRef = useRef<HTMLDivElement | null>(null);
    const stageSize = useElementSize(stageRef);

    const [leftOpen, setLeftOpen] = useState(true);
    const [rightOpen, setRightOpen] = useState(true);
    const [leftTab, setLeftTab] = useState<LeftTab>("shapes");
    const [exportOpen, setExportOpen] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [publishOpen, setPublishOpen] = useState(false);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [findOpen, setFindOpen] = useState(false);
    const [presenting, setPresenting] = useState(false);
    // The shell sits above the provider, so it reads the store directly.
    const chromeDepth = useSyncExternalStore(
        useCallback((cb: () => void) => store.subscribe(cb), [store]),
        () => store.getState().chromeDepth,
        () => store.getState().chromeDepth
    );
    const hasSelection = useSyncExternalStore(
        useCallback((cb: () => void) => store.subscribe(cb), [store]),
        () => store.getState().selection.length > 0,
        () => false
    );
    const everything = chromeDepth === "everything";
    const leftShown = leftOpen && everything;
    // The inspector is a property sheet. With nothing selected it has no
    // subject, so the panel closes rather than filling with page settings —
    // those live behind the top bar's Appearance control.
    const rightShown = rightOpen && everything && hasSelection;
    const [publishedId, setPublishedId] = useState(props.publishedDocumentId);

    const getSvgElement = useCallback(() => stageRef.current?.querySelector("svg") ?? null, []);

    const autosave = useAutosave(store, props.mindmapId, props.initialRevision, getSvgElement);
    const presence = usePresence(store, props.mindmapId, props.author, autosave.revision);

    // Frame the board, and keep framing it until the author moves it. The
    // canvas is not at its final size on mount — the panels are still sliding
    // in — and a template framed against that half-width stage is what opened
    // at 5%.
    const frame = useAutoFit(store, stageSize);

    // Persist a template that was built on open. Runs once.
    const seeded = useRef(false);
    useEffect(() => {
        if (!props.needsInitialSave || seeded.current) return;
        seeded.current = true;
        void autosave.saveNow({ snapshot: true, label: "Created from template" });
    }, [autosave, props.needsInitialSave]);

    // Leaving is a save first: the preview the workspace returns to reads the
    // row, and it should show what was just drawn.
    const { onBack } = props;
    const leave = useMemo(() => {
        if (!onBack) return undefined;
        return () => {
            void autosave.saveNow().finally(onBack);
        };
    }, [autosave, onBack]);

    // The store is read for the current value rather than through a state
    // updater: an updater may run during render, and notifying the store's
    // subscribers from there is a setState-in-render on every panel.
    const togglePresent = useCallback(() => {
        const next = !store.getState().presenting;
        store.setPresenting(next);
        setPresenting(next);
        if (next) {
            setLeftOpen(false);
            setRightOpen(false);
        }
    }, [store]);

    useEffect(() => {
        if (!presenting) return;
        // Refit whenever presentation starts, so the audience sees everything.
        frame(stageSize);
    }, [presenting, stageSize, frame]);

    /** Step through pages like slides while presenting. */
    const stepPage = useCallback(
        (delta: number) => {
            const doc = store.getState().doc;
            const index = doc.pages.findIndex(p => p.id === doc.activePageId);
            const next = doc.pages[index + delta];
            if (!next) return;
            setActivePage(store, next.id);
            // The new page has its own content; frame it before it is shown.
            requestAnimationFrame(() => frame(stageSize));
        },
        [stageSize, frame, store]
    );

    useEffect(() => {
        if (!presenting) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") stepPage(1);
            if (e.key === "ArrowLeft" || e.key === "PageUp") stepPage(-1);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [presenting, stepPage]);

    const editSelection = useCallback(() => {
        const state = store.getState();
        const node = state.selection.find(s => s.kind === "node");
        if (node) {
            store.setEditing({ kind: "node", id: node.id });
            return;
        }
        const edge = state.selection.find(s => s.kind === "edge");
        if (edge) store.setEditing({ kind: "edge-label", id: edge.id, index: 0 });
    }, [store]);

    useKeyboard(store, {
        onSave: () => void autosave.saveNow({ snapshot: true }),
        onFind: () => setFindOpen(true),
        onCommandPalette: () => setPaletteOpen(true),
        onExport: () => setExportOpen(true),
        onTogglePresent: togglePresent,
        onShowShortcuts: () => setShortcutsOpen(true),
        onEditSelection: editSelection,
        getViewportSize: () => stageSize,
    });

    // The canvas is one right-click target. Its own handler fixes the
    // selection under the cursor first (React's delegated handler runs before
    // the document-level one), so the menu built here always acts on what
    // was clicked. Right-drags pan, and the handler swallows their event.
    const onAskAboutNode = props.onAskAboutNode;
    const canvasTarget = useContextTarget({
        kind: "mindmap-canvas",
        label: "Canvas actions",
        items: () => buildCanvasMenuItems(store, { onAskAboutNode }),
    });

    const canvasCallbacks = useMemo(
        () => ({
            // The shared context-menu layer opens from the same event; the
            // canvas handler's job is only to make sure the right thing is
            // selected, which `useCanvasInteractions` already did before this.
            onContextMenuAt: () => undefined,
            onEditText: (target: { kind: "node" | "edge-label"; id: string; index?: number }) =>
                store.setEditing(target),
            onOpenComments: () => setLeftTab("comments"),
            // A shape placed by hand should stay where it was put, so a Move or
            // Resize ends auto-arrange — with the way back one click away.
            onGestureEnd: (label: string) => {
                if (label !== "Move" && label !== "Resize") return;
                const paused = pauseAutoArrangeAfterManualMove(store);
                if (!paused) return;
                toast("Auto-arrange paused", {
                    description: "You placed something by hand, so the map stays as you left it.",
                    action: { label: "Resume", onClick: () => setAutoLayout(store, paused) },
                });
            },
        }),
        [store]
    );

    const commands = useMemo(
        () =>
            buildCommands(store, {
                onSave: () => void autosave.saveNow({ snapshot: true }),
                onExport: () => setExportOpen(true),
                onImport: () => setImportOpen(true),
                onPublish: () => setPublishOpen(true),
                onPresent: togglePresent,
                onShortcuts: () => setShortcutsOpen(true),
                onFit: () => frame(stageSize),
            }),
        [autosave, frame, stageSize, store, togglePresent]
    );

    /** Screen point → world, for drops. Falls back to the viewport centre. */
    const worldPointAt = useCallback(
        (clientX?: number, clientY?: number): Point => {
            const viewport = store.getState().viewport;
            const svg = getSvgElement();
            if (!svg || clientX === undefined || clientY === undefined) {
                return viewportCentre(viewport, stageSize);
            }
            const box = svg.getBoundingClientRect();
            return {
                x: (clientX - box.left) / viewport.zoom + viewport.x,
                y: (clientY - box.top) / viewport.zoom + viewport.y,
            };
        },
        [getSvgElement, stageSize, store]
    );

    useClipboardPaste(store, () => worldPointAt());

    /**
     * Drops land at the pointer: a shape dragged from the palette, image files
     * from the desktop, or a `.json` mindmap to import.
     */
    const onDrop = useCallback(
        (e: React.DragEvent<HTMLDivElement>) => {
            const shape = e.dataTransfer.getData("application/x-launchstack-shape");
            const files = Array.from(e.dataTransfer.files ?? []);
            if (!shape && files.length === 0) return;
            e.preventDefault();
            const world = worldPointAt(e.clientX, e.clientY);

            if (shape) {
                const node = createNodeAt(shape as ShapeId, world, { mode: docMode(store) });
                store.updatePage(p => ({ ...p, nodes: [...p.nodes, node] }), {
                    label: "Add shape",
                });
                store.selectNodes([node.id]);
                // Same as placing one with the shape tool: land in the label,
                // so a dropped box asks to be named rather than sitting blank.
                if (shapeHoldsText(shape)) store.setEditing({ kind: "node", id: node.id });
                return;
            }

            const images = files.filter(isImageFile);
            if (images.length > 0) void insertImages(store, images, world);

            const document = files.find(f => f.name.endsWith(".json"));
            if (document) void importDocumentFile(store, document);
        },
        [store, worldPointAt]
    );

    return (
        <EditorProvider store={store}>
            <TooltipProvider delayDuration={400}>
                <div className="bg-surface flex h-full min-h-0 flex-col">
                    {!presenting && (
                        <TopBar
                            peers={presence.peers}
                            onBack={leave}
                            onSave={() => void autosave.saveNow({ snapshot: true })}
                            onExport={() => setExportOpen(true)}
                            onImport={() => setImportOpen(true)}
                            onPublish={() => setPublishOpen(true)}
                            onPresent={togglePresent}
                            onShortcuts={() => setShortcutsOpen(true)}
                            onCommandPalette={() => setPaletteOpen(true)}
                            leftPanelOpen={leftShown}
                            rightPanelOpen={rightShown}
                            depth={chromeDepth}
                            onToggleDepth={() => {
                                const next = everything ? "focus" : "everything";
                                store.setChromeDepth(next);
                                writeChromeDepth(store.getState().doc.settings.kind, next);
                            }}
                            onHistory={() => {
                                store.setChromeDepth("everything");
                                setLeftOpen(true);
                                setLeftTab("history");
                            }}
                            onCopyPresentLink={() => {
                                const url = `${window.location.origin}/employer/documents?source=m${props.mindmapId}&present=1`;
                                void navigator.clipboard.writeText(url).then(
                                    () =>
                                        toast("Presentation link copied", {
                                            description:
                                                "Opens the map straight into Present for anyone in the workspace.",
                                        }),
                                    () =>
                                        toast.error("Couldn't copy the link", { description: url })
                                );
                            }}
                            onToggleLeft={() => setLeftOpen(v => !v)}
                            onToggleRight={() => setRightOpen(v => !v)}
                        />
                    )}

                    <div className="flex min-h-0 flex-1">
                        {!presenting && (
                            <Toolbar
                                depth={chromeDepth}
                                onOpenShapes={() => {
                                    setLeftOpen(true);
                                    setLeftTab("shapes");
                                }}
                            />
                        )}

                        {/* The rail stays a fixed strip; only the two panels and
                            the canvas share the remaining width. `autoSaveId`
                            persists the split per browser, and the explicit
                            `id`/`order` are what let a panel be unmounted by its
                            toggle and come back the same size. */}
                        <ResizablePanelGroup
                            direction="horizontal"
                            autoSaveId="mindmap-editor-panels"
                            className="min-h-0 flex-1"
                        >
                            {!presenting && leftShown && (
                                <>
                                    <ResizablePanel
                                        id="left"
                                        order={1}
                                        defaultSize={19}
                                        minSize={13}
                                        maxSize={36}
                                        className="flex min-h-0 flex-col"
                                    >
                                        <aside className="border-line bg-panel flex min-h-0 min-w-0 flex-1 flex-col border-r">
                                            <nav className="border-line flex shrink-0 border-b">
                                                <PanelTab
                                                    active={leftTab === "shapes"}
                                                    onClick={() => setLeftTab("shapes")}
                                                    icon={<Shapes className="size-3.5" />}
                                                    label="Shapes"
                                                />
                                                <PanelTab
                                                    active={leftTab === "outline"}
                                                    onClick={() => setLeftTab("outline")}
                                                    icon={<Layers className="size-3.5" />}
                                                    label="Outline"
                                                />
                                                <PanelTab
                                                    active={leftTab === "comments"}
                                                    onClick={() => setLeftTab("comments")}
                                                    icon={<MessageSquare className="size-3.5" />}
                                                    label="Comments"
                                                />
                                                <PanelTab
                                                    active={leftTab === "history"}
                                                    onClick={() => setLeftTab("history")}
                                                    icon={<HistoryIcon className="size-3.5" />}
                                                    label="History"
                                                />
                                            </nav>
                                            <div className="min-h-0 flex-1">
                                                {leftTab === "shapes" && <ShapePalette />}
                                                {leftTab === "outline" && (
                                                    <OutlinePanel canvasSize={stageSize} />
                                                )}
                                                {leftTab === "comments" && (
                                                    <CommentsPanel
                                                        author={props.author}
                                                        canvasSize={stageSize}
                                                    />
                                                )}
                                                {leftTab === "history" && (
                                                    <HistoryPanel
                                                        mindmapId={props.mindmapId}
                                                        onRestored={autosave.setRevision}
                                                    />
                                                )}
                                            </div>
                                        </aside>
                                    </ResizablePanel>
                                    <ResizableHandle />
                                </>
                            )}

                            <ResizablePanel
                                id="canvas"
                                order={2}
                                minSize={30}
                                className="flex min-h-0"
                            >
                                <div
                                    ref={stageRef}
                                    className="relative flex min-h-0 min-w-0 flex-1"
                                    onDragOver={e => {
                                        const types = e.dataTransfer.types;
                                        if (
                                            types.includes("application/x-launchstack-shape") ||
                                            types.includes("Files")
                                        ) {
                                            e.preventDefault();
                                            e.dataTransfer.dropEffect = "copy";
                                        }
                                    }}
                                    onDrop={onDrop}
                                >
                                    <div className="flex min-h-0 min-w-0 flex-1" {...canvasTarget}>
                                        <Canvas
                                            callbacks={canvasCallbacks}
                                            peers={presence.peers}
                                            onCursorMove={presence.reportCursor}
                                        >
                                            <TextEditorOverlay />
                                        </Canvas>
                                    </div>

                                    <ConnectedStaleBanner staleBy={presence.staleBy} />

                                    <SelectionToolbar
                                        onMore={() => {
                                            store.setChromeDepth("everything");
                                            setRightOpen(true);
                                        }}
                                    />
                                    <EmptyCanvasHint
                                        canvasSize={stageSize}
                                        onPasteOutline={() => setImportOpen(true)}
                                    />

                                    <FindBar
                                        open={findOpen}
                                        onClose={() => setFindOpen(false)}
                                        canvasSize={stageSize}
                                    />

                                    {presenting &&
                                        (chromeDepth === "focus" ? (
                                            <Presenter
                                                canvasSize={stageSize}
                                                onExit={togglePresent}
                                            />
                                        ) : (
                                            <PresentationControls
                                                onExit={togglePresent}
                                                onStep={stepPage}
                                            />
                                        ))}
                                </div>
                            </ResizablePanel>

                            {!presenting && rightShown && (
                                <>
                                    <ResizableHandle />
                                    <ResizablePanel
                                        id="right"
                                        order={3}
                                        defaultSize={19}
                                        minSize={13}
                                        maxSize={36}
                                        className="flex min-h-0"
                                    >
                                        <aside className="border-line bg-panel min-h-0 min-w-0 flex-1 border-l">
                                            <Inspector />
                                        </aside>
                                    </ResizablePanel>
                                </>
                            )}
                        </ResizablePanelGroup>
                    </div>

                    {!presenting && <BottomBar canvasSize={stageSize} />}
                </div>

                <ExportDialog
                    open={exportOpen}
                    onOpenChange={setExportOpen}
                    getSvgElement={getSvgElement}
                />
                <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
                <PublishDialog
                    open={publishOpen}
                    onOpenChange={setPublishOpen}
                    mindmapId={props.mindmapId}
                    defaultFolder={props.folder}
                    publishedDocumentId={publishedId}
                    onPublished={setPublishedId}
                />
                <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
                <CommandPalette
                    open={paletteOpen}
                    onOpenChange={setPaletteOpen}
                    commands={commands}
                />
            </TooltipProvider>
        </EditorProvider>
    );
}

/**
 * The banner needs the dirty flag, which only exists inside the provider — the
 * shell that owns the store cannot read it at its own level.
 */
function ConnectedStaleBanner({ staleBy }: { staleBy: number }) {
    const dirty = useEditor(selectDirty);
    return <StaleBanner staleBy={staleBy} dirty={dirty} />;
}

/**
 * Presentation chrome: page position, prev/next and exit. Rendered only while
 * presenting, so the canvas is otherwise completely bare.
 */
function PresentationControls({
    onExit,
    onStep,
}: {
    onExit: () => void;
    onStep: (delta: number) => void;
}) {
    const doc = useCommittedDoc();
    const pages = doc.pages;
    const index = pages.findIndex(p => p.id === doc.activePageId);

    return (
        <div className="border-line bg-panel shadow-2 absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border px-2 py-1.5">
            <button
                type="button"
                onClick={() => onStep(-1)}
                disabled={index <= 0}
                aria-label="Previous page"
                className="text-ink-2 hover:bg-panel-2 flex size-7 items-center justify-center rounded-full disabled:opacity-35"
            >
                <ChevronLeft className="size-4" />
            </button>
            <span className="text-ink-3 min-w-16 text-center font-mono text-[12px] tabular-nums">
                {index + 1} / {pages.length}
            </span>
            <button
                type="button"
                onClick={() => onStep(1)}
                disabled={index >= pages.length - 1}
                aria-label="Next page"
                className="text-ink-2 hover:bg-panel-2 flex size-7 items-center justify-center rounded-full disabled:opacity-35"
            >
                <ChevronRight className="size-4" />
            </button>
            <span className="bg-line mx-1 h-4 w-px" />
            <button
                type="button"
                onClick={onExit}
                className="text-ink-2 hover:bg-panel-2 flex items-center gap-1.5 rounded-full px-2 py-1 text-[12px]"
            >
                <X className="size-3.5" />
                Exit · Esc
            </button>
        </div>
    );
}

function PanelTab({
    active,
    onClick,
    icon,
    label,
}: {
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[10px] font-medium transition-colors",
                active
                    ? "border-brand text-brand-ink border-b-2"
                    : "text-ink-3 hover:text-ink-2 border-b-2 border-transparent"
            )}
        >
            {icon}
            {label}
        </button>
    );
}
