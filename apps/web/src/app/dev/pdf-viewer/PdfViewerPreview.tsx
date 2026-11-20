"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import type { PdfNoteLite } from "~/components/notes/PdfViewerWithNotes";
import type { HighlightColor } from "~/components/notes/_shared/highlight";
import type { ViewerHighlight } from "~/lib/find-text-range";

const PdfViewerWithNotes = dynamic(
    () => import("~/components/notes/PdfViewerWithNotes").then(m => m.PdfViewerWithNotes),
    { ssr: false }
);

/**
 * Local harness for the PDF viewer: the real component over any PDF, in a
 * column of any width, with in-memory notes and highlights and a simulated
 * citation click — so a 300-page book can be tried without a workspace.
 *
 *   /dev/pdf-viewer?url=<pdf url>&width=580
 *
 * The URL must be same-origin or served with CORS headers, since pdf.js
 * fetches it from the page. Gated by the server page.
 */
export function PdfViewerPreview() {
    const [params, setParams] = useState<URLSearchParams | null>(null);
    useEffect(() => setParams(new URLSearchParams(window.location.search)), []);

    const [url, setUrl] = useState("");
    const [draftUrl, setDraftUrl] = useState("");
    const [width, setWidth] = useState<number | null>(null);
    const [notes, setNotes] = useState<PdfNoteLite[]>([]);
    const [citeText, setCiteText] = useState("");
    const [citePage, setCitePage] = useState("");
    const [highlight, setHighlight] = useState<ViewerHighlight | null>(null);
    const [lastAsk, setLastAsk] = useState<string | null>(null);
    const [scrollToNoteId, setScrollToNoteId] = useState<number | null>(null);
    const [scrollToNoteNonce, setScrollToNoteNonce] = useState(0);
    const nextId = useRef(1);
    const nonce = useRef(0);

    useEffect(() => {
        if (!params) return;
        const fromQuery = params.get("url") ?? "";
        setUrl(fromQuery);
        setDraftUrl(fromQuery);
        const w = Number(params.get("width"));
        setWidth(Number.isFinite(w) && w > 0 ? w : null);
    }, [params]);

    if (!params) return null;

    const field = {
        height: 26,
        padding: "0 8px",
        borderRadius: 6,
        border: "1px solid var(--line)",
        background: "var(--panel)",
        color: "var(--ink)",
        fontSize: 12,
    } as const;
    const button = {
        height: 26,
        padding: "0 10px",
        borderRadius: 6,
        background: "var(--panel-2)",
        border: "1px solid var(--line)",
        color: "var(--ink-2)",
        fontSize: 12,
        fontWeight: 600,
    } as const;

    return (
        <div
            style={{
                height: "100vh",
                display: "flex",
                flexDirection: "column",
                background: "var(--bg)",
                color: "var(--ink)",
            }}
        >
            <div
                data-testid="harness-bar"
                style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 12px",
                    borderBottom: "1px solid var(--line)",
                    background: "var(--panel)",
                    fontSize: 12,
                }}
            >
                <input
                    aria-label="PDF URL"
                    value={draftUrl}
                    placeholder="PDF URL"
                    onChange={e => setDraftUrl(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === "Enter") setUrl(draftUrl);
                    }}
                    style={{ ...field, width: 360 }}
                />
                <button type="button" style={button} onClick={() => setUrl(draftUrl)}>
                    Load
                </button>
                <span style={{ color: "var(--ink-3)" }}>Column</span>
                {[
                    ["Full", null],
                    ["Beside chat", 580],
                    ["Narrow", 420],
                    ["Phone", 375],
                ].map(([label, value]) => (
                    <button
                        key={String(label)}
                        type="button"
                        data-testid={`width-${String(label).toLowerCase().replace(/\s+/g, "-")}`}
                        aria-pressed={width === value}
                        onClick={() => setWidth(value as number | null)}
                        style={{
                            ...button,
                            ...(width === value
                                ? { background: "var(--brand-soft)", color: "var(--brand-ink)" }
                                : null),
                        }}
                    >
                        {label}
                    </button>
                ))}
                <input
                    aria-label="Cited passage"
                    value={citeText}
                    placeholder="Cited passage"
                    onChange={e => setCiteText(e.target.value)}
                    style={{ ...field, width: 260 }}
                />
                <input
                    aria-label="Page hint"
                    value={citePage}
                    placeholder="p."
                    inputMode="numeric"
                    onChange={e => setCitePage(e.target.value.replace(/\D/g, ""))}
                    style={{ ...field, width: 48 }}
                />
                <button
                    type="button"
                    data-testid="simulate-citation"
                    style={{ ...button, background: "var(--accent)", color: "white" }}
                    onClick={() => {
                        nonce.current += 1;
                        setHighlight({
                            text: citeText,
                            page: citePage ? Number(citePage) : null,
                            nonce: nonce.current,
                        });
                    }}
                >
                    Jump to passage
                </button>
                <button
                    type="button"
                    style={button}
                    onClick={() => {
                        const root = document.documentElement;
                        root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
                    }}
                >
                    Theme
                </button>
                <span style={{ color: "var(--ink-3)" }} data-testid="harness-notes">
                    {notes.length} note(s)
                    {lastAsk ? ` · asked: "${lastAsk.slice(0, 40)}"` : ""}
                </span>
            </div>
            <div
                style={{
                    flex: 1,
                    minHeight: 0,
                    display: "flex",
                    justifyContent: "center",
                    background: "var(--surface-2)",
                }}
            >
                <div
                    data-testid="harness-column"
                    style={{
                        width: width ?? "100%",
                        maxWidth: "100%",
                        minHeight: 0,
                        display: "flex",
                        flexDirection: "column",
                        borderLeft: width ? "1px solid var(--line)" : undefined,
                        borderRight: width ? "1px solid var(--line)" : undefined,
                        background: "var(--bg)",
                    }}
                >
                    {url ? (
                        <PdfViewerWithNotes
                            key={url}
                            url={url}
                            // Match the workspace host, which maps its stored
                            // notes into fresh viewer rows on each render.
                            notes={notes.map(note => ({ ...note }))}
                            scrollToNoteId={scrollToNoteId}
                            scrollToNoteNonce={scrollToNoteNonce}
                            persistKey={`dev:${url}`}
                            citationHighlight={highlight}
                            downloadUrl={url}
                            downloadName="document.pdf"
                            onCreateAnchoredNote={anchor =>
                                setNotes(list => [
                                    ...list,
                                    {
                                        id: nextId.current++,
                                        title: `Note ${list.length + 1}`,
                                        page: anchor.page,
                                        quads: anchor.quads,
                                        quote: anchor.quote.exact,
                                    },
                                ])
                            }
                            onCreateHighlight={capture =>
                                setNotes(list => [
                                    ...list,
                                    {
                                        id: nextId.current++,
                                        title: null,
                                        page: capture.page,
                                        quads: capture.quads,
                                        quote: capture.quote.exact,
                                        highlight: capture.color,
                                    },
                                ])
                            }
                            onRecolorHighlight={(id, color: HighlightColor) =>
                                setNotes(list =>
                                    list.map(n => (n.id === id ? { ...n, highlight: color } : n))
                                )
                            }
                            onRemoveHighlight={id =>
                                setNotes(list => list.filter(n => n.id !== id))
                            }
                            onNotePinClick={id => {
                                setScrollToNoteId(id);
                                setScrollToNoteNonce(value => value + 1);
                            }}
                            onAskAi={selection => setLastAsk(selection.text)}
                        />
                    ) : (
                        <div style={{ padding: 40, color: "var(--ink-3)", textAlign: "center" }}>
                            Add ?url=&lt;pdf&gt; to the address, or paste one above and press Load.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
