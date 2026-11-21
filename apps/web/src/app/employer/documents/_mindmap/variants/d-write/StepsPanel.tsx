"use client";

import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
} from "react";
import { useTranslations } from "next-intl";
import { CircleAlert, CornerDownRight, FileText } from "lucide-react";

import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Textarea } from "~/components/ui/textarea";
import { cn } from "~/lib/utils";

import { revealNode } from "../../model/commands";
import { activePage, pageBounds } from "../../model/doc";
import { fitViewport, screenToWorld } from "../../model/geometry";
import { shapeGeometry } from "../../model/shapes";
import type { EditorStore } from "../../model/store";
import type { ShapeId } from "../../model/types";
import { useSelectedNodeIds, useStore } from "../../ui/EditorContext";
import { stepsSyncFor } from "./sync";
import { isIndented, type StepKind, type StepsParse } from "../../model/flowchart/syntax";

/**
 * The Steps panel: the process as lines, docked left of the canvas.
 *
 * A real `<textarea>` over a backdrop that draws the same lines: the textarea
 * owns typing, IME, native undo and selection; the backdrop paints what a
 * textarea cannot — a glyph per line showing the box it draws, the line of
 * the selected box, and lines with a note. Both use one font, size, line
 * height, padding and width, so they wrap identically; the backdrop sets the
 * height and the textarea fills it, so neither scrolls on its own and the
 * panel's scroll area moves both together.
 */

type Size = { w: number; h: number };

/** Space above the first step when the chart starts on an empty board. */
const TOP_MARGIN = 72;
const LINE_HEIGHT = 20;
const INDENT = "  ";

/** Frame the whole chart, never zoomed past 100%. */
export function frameChart(store: EditorStore, size: Size): void {
    const bounds = pageBounds(activePage(store.getState().doc));
    if (!bounds || size.w < 40 || size.h < 40) return;
    store.setViewport(fitViewport(bounds, size, 64, 1));
}

/** Replace the lines with the example, as one undo step, and frame it. */
export function fillExample(store: EditorStore, text: string, size: Size): void {
    stepsSyncFor(store).replace(text, "Use an example");
    frameChart(store, size);
}

/** The shape a line draws, drawn small: the same outline the chart uses. */
function ShapeGlyph({ kind }: { kind: StepKind }) {
    const shape: ShapeId =
        kind === "decision" ? "decision" : kind === "step" ? "process" : "terminator";
    const w = kind === "decision" ? 12 : 13;
    const h = kind === "decision" ? 11 : kind === "step" ? 9 : 8;
    const path = shapeGeometry(shape, w, h, kind === "step" ? 2 : 0).path;
    return (
        <svg width={w + 2} height={h + 2} viewBox={`-1 -1 ${w + 2} ${h + 2}`} aria-hidden>
            <path d={path} fill="none" stroke="currentColor" strokeWidth={1.25} />
        </svg>
    );
}

interface LineView {
    text: string;
    kind: StepKind | "arrow" | null;
    note: boolean;
}

function viewLines(text: string, parse: StepsParse): LineView[] {
    const noted = new Set(parse.notes.map(n => n.line));
    return text.split("\n").map((t, i) => {
        const l = parse.lines[i];
        let kind: LineView["kind"] = null;
        if (l && l.step !== null) kind = parse.steps[l.step]!.kind;
        else if (l && l.source !== null) kind = "arrow";
        return { text: t, kind, note: noted.has(i) };
    });
}

/** Which line the caret is on. */
function caretLine(el: HTMLTextAreaElement): number {
    return el.value.slice(0, el.selectionStart).split("\n").length - 1;
}

/**
 * Type `text` at the selection the way a keystroke would, so the textarea's
 * own undo keeps it. Falls back to a plain splice where `insertText` is gone.
 */
function typeInto(el: HTMLTextAreaElement, text: string): void {
    if (document.execCommand?.("insertText", false, text)) return;
    el.setRangeText(text, el.selectionStart, el.selectionEnd, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Delete [from, to) the way Backspace would (undo keeps it), and leave the
 * caret at `from`: Chrome puts it a character early after a deletion that
 * ends a line.
 */
function deleteRange(el: HTMLTextAreaElement, from: number, to: number): void {
    el.setSelectionRange(from, to);
    if (!document.execCommand?.("delete")) {
        el.setRangeText("", from, to, "start");
        el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.setSelectionRange(from, from);
}

export function StepsPanel({ canvasSize }: { canvasSize: Size }) {
    const t = useTranslations("mindmap.variants.d");
    const store = useStore();
    const sync = useMemo(() => stepsSyncFor(store), [store]);
    const sizeRef = useRef(canvasSize);
    sizeRef.current = canvasSize;

    useEffect(() => {
        sync.setOrigin(() => {
            const size = sizeRef.current;
            if (size.w < 40) return undefined;
            return screenToWorld(store.getState().viewport, { x: size.w / 2, y: TOP_MARGIN });
        });
        sync.start();
        return () => sync.stop();
    }, [store, sync]);

    const snap = useSyncExternalStore(sync.subscribe, sync.getSnapshot, sync.getSnapshot);
    const selectedIds = useSelectedNodeIds();
    const fieldRef = useRef<HTMLTextAreaElement | null>(null);
    const linesRef = useRef<HTMLDivElement | null>(null);
    const [focused, setFocused] = useState(false);

    const lines = useMemo(() => viewLines(snap.text, snap.parse), [snap.text, snap.parse]);
    // The lines of the selected boxes, as last drawn.
    const selectedLines = useMemo(() => {
        const out = new Set<number>();
        for (const id of selectedIds) {
            const line = sync.lineOfNode(id);
            if (line !== null) out.add(line);
        }
        return out;
        // `snap.bound` is what `lineOfNode` reads.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedIds, snap.bound, sync]);

    const scrollToLine = useCallback((line: number) => {
        const row = linesRef.current?.querySelector<HTMLElement>(`[data-line="${line}"]`);
        row?.scrollIntoView({ block: "nearest" });
    }, []);

    /** The caret's line selects (and reveals) the box it draws. */
    const followCaret = useCallback(() => {
        const el = fieldRef.current;
        if (!el || document.activeElement !== el) return;
        const line = caretLine(el);
        scrollToLine(line);
        // While the newest keystrokes are not drawn yet, lines and boxes may
        // not line up; the next drawing calls this again.
        const now = sync.getSnapshot();
        if (now.text !== now.bound.text) return;
        const id = sync.nodeOnLine(line);
        if (!id) return;
        const sel = store.getState().selection;
        if (!(sel.length === 1 && sel[0]!.kind === "node" && sel[0]!.id === id)) {
            store.selectNodes([id]);
        }
        revealNode(store, id, sizeRef.current);
    }, [scrollToLine, store, sync]);

    useEffect(() => {
        if (focused) followCaret();
    }, [focused, followCaret, snap.bound]);

    // A box selected on the canvas brings its line into view.
    useEffect(() => {
        if (focused || selectedLines.size === 0) return;
        scrollToLine(Math.min(...selectedLines));
    }, [focused, scrollToLine, selectedLines]);

    const goToLine = (line: number) => {
        const el = fieldRef.current;
        if (!el) return;
        const rows = el.value.split("\n");
        const end = rows.slice(0, line + 1).join("\n").length;
        el.focus();
        el.setSelectionRange(end, end);
        followCaret();
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.nativeEvent.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
        const el = e.currentTarget;
        const value = el.value;
        const start = el.selectionStart;
        const lineStart = value.lastIndexOf("\n", start - 1) + 1;
        const newline = value.indexOf("\n", start);
        const lineEnd = newline < 0 ? value.length : newline;
        const line = value.slice(lineStart, lineEnd);
        const lead = /^[ \t]*/.exec(line)![0];

        if (e.key === "Escape") {
            e.preventDefault();
            el.blur();
            return;
        }
        if (e.key === "Tab") {
            // Tab indents the line into a branch; ⇧Tab takes it back out.
            e.preventDefault();
            const caret = start;
            if (e.shiftKey) {
                const cut = lead.startsWith("\t") ? 1 : Math.min(lead.length, INDENT.length);
                if (cut === 0) return;
                deleteRange(el, lineStart, lineStart + cut);
                const at = Math.max(lineStart, caret - cut);
                el.setSelectionRange(at, at);
            } else {
                el.setSelectionRange(lineStart, lineStart);
                typeInto(el, INDENT);
                el.setSelectionRange(caret + INDENT.length, caret + INDENT.length);
            }
            return;
        }
        if (e.key === "Enter" && !e.shiftKey && el.selectionEnd === start) {
            const before = value.slice(lineStart, start);
            if (line.trim() === "" && lead.length > 0 && start === lineEnd) {
                // Enter on an empty branch line leaves the block.
                e.preventDefault();
                deleteRange(el, lineStart, lineEnd);
                return;
            }
            if (!isIndented(lead) && /[?？]\s*$/.test(before) && start === lineEnd) {
                // After a question, the next line starts its first branch.
                e.preventDefault();
                typeInto(el, `\n${INDENT}`);
                return;
            }
            if (isIndented(lead)) {
                // Another branch of the same decision.
                e.preventDefault();
                typeInto(el, `\n${lead}`);
            }
        }
    };

    const empty = snap.text.trim() === "";
    const notes = snap.parse.notes;

    return (
        <div className="flex min-h-0 flex-1 flex-col" data-steps-panel="">
            <header className="flex items-baseline justify-between gap-2 px-4 pb-2 pt-3">
                <h2 className="text-ink text-[13px] font-semibold">{t("panel.title")}</h2>
                <span className="text-ink-3 text-[11.5px] tabular-nums">
                    {t("panel.count", { count: snap.parse.steps.length })}
                </span>
            </header>

            <ScrollArea className="min-h-0 flex-1">
                <div className="px-3 pb-3">
                    <div className="border-line bg-surface-2 focus-within:border-brand focus-within:ring-brand/30 relative min-h-[216px] rounded-md border transition-[border-color,box-shadow] focus-within:ring-[3px]">
                        <div
                            ref={linesRef}
                            aria-hidden
                            className="pointer-events-none py-2 font-mono text-[12.5px] leading-5 [tab-size:2]"
                        >
                            {lines.map((line, i) => (
                                <div
                                    key={i}
                                    data-line={i}
                                    data-selected={selectedLines.has(i) ? "" : undefined}
                                    className={cn(
                                        "relative min-h-5 whitespace-pre-wrap break-words pl-7 pr-3 text-transparent",
                                        line.note && "bg-warn-soft",
                                        selectedLines.has(i) && "bg-brand-soft"
                                    )}
                                >
                                    {line.kind && (
                                        <span
                                            className={cn(
                                                "absolute left-0 top-0 flex w-7 items-center justify-center",
                                                selectedLines.has(i)
                                                    ? "text-brand"
                                                    : line.note
                                                      ? "text-warn"
                                                      : "text-ink-3"
                                            )}
                                            style={{ height: LINE_HEIGHT }}
                                            title={t(`kind.${line.kind}`)}
                                        >
                                            {line.kind === "arrow" ? (
                                                <CornerDownRight className="size-3" />
                                            ) : (
                                                <ShapeGlyph kind={line.kind} />
                                            )}
                                        </span>
                                    )}
                                    {line.text || "​"}
                                </div>
                            ))}
                        </div>
                        <Textarea
                            ref={fieldRef}
                            value={snap.text}
                            onChange={e => {
                                sync.edit(e.target.value);
                                followCaret();
                            }}
                            onSelect={followCaret}
                            onFocus={() => setFocused(true)}
                            onBlur={() => {
                                setFocused(false);
                                // Leaving the panel lands the typing as one undo step.
                                sync.flush();
                                sync.endBurst();
                            }}
                            onKeyDown={onKeyDown}
                            placeholder={t("panel.placeholder")}
                            aria-label={t("panel.editorLabel")}
                            spellCheck={false}
                            autoComplete="off"
                            className="text-ink absolute inset-0 h-full min-h-0 resize-none overflow-hidden rounded-md border-0 bg-transparent py-2 pl-7 pr-3 font-mono text-[12.5px] leading-5 shadow-none [field-sizing:fixed] [tab-size:2] focus-visible:ring-0 dark:bg-transparent"
                        />
                    </div>

                    {empty && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-3 w-full"
                            onClick={() => fillExample(store, t("panel.example"), sizeRef.current)}
                        >
                            <FileText />
                            {t("panel.useExample")}
                        </Button>
                    )}

                    {notes.length > 0 && (
                        <ul className="mt-2 space-y-1">
                            {notes.map(note => (
                                <li key={`${note.line}:${note.kind}`}>
                                    <button
                                        type="button"
                                        onClick={() => goToLine(note.line)}
                                        className="bg-warn-soft text-warn-ink flex w-full items-start gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] leading-snug"
                                    >
                                        <CircleAlert className="text-warn mt-px size-3.5 shrink-0" />
                                        <span>
                                            {t(`notes.${note.kind}`, {
                                                line: note.line + 1,
                                                target: note.target ?? "",
                                            })}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </ScrollArea>

            <footer className="border-line border-t px-4 pb-3 pt-2.5">
                <h3 className="text-ink-3 mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.08em]">
                    {t("syntax.title")}
                </h3>
                <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 text-[11.5px]">
                    {(["step", "decision", "branch", "jump", "ends"] as const).map(rule => (
                        <React.Fragment key={rule}>
                            <dt className="text-ink-2 whitespace-pre font-mono text-[11px]">
                                {t(`syntax.${rule}Code`)}
                            </dt>
                            <dd className="text-ink-3">{t(`syntax.${rule}`)}</dd>
                        </React.Fragment>
                    ))}
                </dl>
                <p className="text-ink-3 mt-2 text-[11px]">{t("panel.keys")}</p>
            </footer>
        </div>
    );
}
