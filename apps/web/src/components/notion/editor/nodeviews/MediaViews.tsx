"use client";

/**
 * Node views for every media block: image, video, audio, file, bookmark, and
 * generic embed.
 *
 * They share one lifecycle — an empty placeholder that offers Upload / Embed
 * link, then the rendered media with a caption and a hover toolbar — so the
 * placeholder and the caption live here once rather than six times.
 */

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
    AlignCenter,
    AlignLeft,
    AlignRight,
    Bookmark as BookmarkIcon,
    Download,
    ExternalLink,
    File as FileIcon,
    Image as ImageIcon,
    Loader2,
    Music,
    PanelTop,
    Trash2,
    Video,
    type LucideIcon,
} from "lucide-react";
import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type CSSProperties,
    type ReactNode,
} from "react";

import { useNotionEditor } from "../../context";
import { embedUrlFor, providerLabel } from "../../lib/embeds";

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/** Empty state: the two ways Notion lets you fill a media block. */
function MediaPlaceholder({
    icon: Icon,
    label,
    accept,
    editable,
    allowUpload = true,
    onFile,
    onUrl,
}: {
    icon: LucideIcon;
    label: string;
    accept?: string;
    editable: boolean;
    allowUpload?: boolean;
    onFile: (file: File) => void;
    onUrl: (url: string) => void;
}) {
    const [tab, setTab] = useState<"upload" | "link">(allowUpload ? "upload" : "link");
    const [open, setOpen] = useState(false);
    const [url, setUrl] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    if (!editable) {
        return (
            <div className="ntn-media__placeholder ntn-media__placeholder--static">
                <Icon size={16} />
                <span>{label}</span>
            </div>
        );
    }

    return (
        <div className="ntn-media__placeholder">
            <button
                type="button"
                className="ntn-media__placeholder-btn"
                onClick={() => setOpen((value) => !value)}
            >
                <Icon size={16} />
                <span>{label}</span>
            </button>

            {open && (
                <div className="ntn-media__panel">
                    <div className="ntn-media__tabs">
                        {allowUpload && (
                            <button
                                type="button"
                                className={`ntn-media__tab${tab === "upload" ? " is-active" : ""}`}
                                onClick={() => setTab("upload")}
                            >
                                Upload
                            </button>
                        )}
                        <button
                            type="button"
                            className={`ntn-media__tab${tab === "link" ? " is-active" : ""}`}
                            onClick={() => setTab("link")}
                        >
                            Embed link
                        </button>
                    </div>

                    {tab === "upload" ? (
                        <div className="ntn-media__panel-body">
                            <input
                                ref={inputRef}
                                type="file"
                                accept={accept}
                                hidden
                                onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    if (file) onFile(file);
                                    event.target.value = "";
                                }}
                            />
                            <button
                                type="button"
                                className="ntn-btn ntn-btn--block"
                                onClick={() => inputRef.current?.click()}
                            >
                                Choose a file
                            </button>
                            <p className="ntn-media__hint">The maximum size is 25 MB.</p>
                        </div>
                    ) : (
                        <form
                            className="ntn-media__panel-body"
                            onSubmit={(event) => {
                                event.preventDefault();
                                const trimmed = url.trim();
                                if (trimmed) onUrl(trimmed);
                            }}
                        >
                            <input
                                className="ntn-input"
                                placeholder="Paste a link…"
                                value={url}
                                autoFocus
                                onChange={(event) => setUrl(event.target.value)}
                            />
                            <button type="submit" className="ntn-btn ntn-btn--block ntn-btn--primary">
                                Embed link
                            </button>
                        </form>
                    )}
                </div>
            )}
        </div>
    );
}

/** The italic line under a media block. Empty captions disappear when idle. */
function Caption({
    value,
    editable,
    onChange,
}: {
    value: string;
    editable: boolean;
    onChange: (next: string) => void;
}) {
    const [focused, setFocused] = useState(false);
    if (!editable && !value) return null;
    if (!editable) return <figcaption className="ntn-media__caption">{value}</figcaption>;

    return (
        <figcaption
            className={`ntn-media__caption${!value && !focused ? " is-empty" : ""}`}
            contentEditable
            suppressContentEditableWarning
            data-placeholder="Write a caption…"
            onFocus={() => setFocused(true)}
            onBlur={(event) => {
                setFocused(false);
                onChange(event.currentTarget.textContent ?? "");
            }}
            onKeyDown={(event) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                }
            }}
        >
            {value}
        </figcaption>
    );
}

/** Hover toolbar shared by the resizable blocks. */
function MediaToolbar({
    align,
    onAlign,
    onDelete,
    extra,
}: {
    align?: string;
    onAlign?: (value: "left" | "center" | "right") => void;
    onDelete: () => void;
    extra?: ReactNode;
}) {
    return (
        <div className="ntn-media__toolbar" contentEditable={false}>
            {extra}
            {onAlign && (
                <>
                    <button
                        type="button"
                        className={`ntn-media__tool${align === "left" ? " is-active" : ""}`}
                        title="Align left"
                        onClick={() => onAlign("left")}
                    >
                        <AlignLeft size={13} />
                    </button>
                    <button
                        type="button"
                        className={`ntn-media__tool${align === "center" ? " is-active" : ""}`}
                        title="Align centre"
                        onClick={() => onAlign("center")}
                    >
                        <AlignCenter size={13} />
                    </button>
                    <button
                        type="button"
                        className={`ntn-media__tool${align === "right" ? " is-active" : ""}`}
                        title="Align right"
                        onClick={() => onAlign("right")}
                    >
                        <AlignRight size={13} />
                    </button>
                </>
            )}
            <button
                type="button"
                className="ntn-media__tool"
                title="Delete"
                onClick={onDelete}
            >
                <Trash2 size={13} />
            </button>
        </div>
    );
}

/** Upload helper shared by the file-backed blocks. */
function useUpload(onDone: (file: { url: string; name: string; size: number; contentType: string }) => void) {
    const { uploadFile } = useNotionEditor();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const upload = useCallback(
        async (file: File) => {
            setBusy(true);
            setError(null);
            try {
                const result = await uploadFile(file);
                if (!result) {
                    setError("Upload failed");
                    return;
                }
                onDone(result);
            } finally {
                setBusy(false);
            }
        },
        [onDone, uploadFile]
    );

    return { upload, busy, error };
}

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------

export function ImageBlockView({
    node,
    updateAttributes,
    deleteNode,
    editor,
    selected,
}: NodeViewProps) {
    const src = node.attrs.src as string | null;
    const align = (node.attrs.align as string) || "center";
    const width = node.attrs.width as number | null;
    const editable = editor.isEditable;
    const frameRef = useRef<HTMLDivElement>(null);
    const { upload, busy } = useUpload((file) =>
        updateAttributes({ src: file.url, alt: file.name })
    );

    const startResize = useCallback(
        (event: React.PointerEvent, edge: "left" | "right") => {
            event.preventDefault();
            const frame = frameRef.current;
            if (!frame) return;
            const startX = event.clientX;
            const startWidth = frame.getBoundingClientRect().width;
            const max = frame.parentElement?.getBoundingClientRect().width ?? 720;

            const onMove = (move: PointerEvent) => {
                const delta = (move.clientX - startX) * (edge === "left" ? -1 : 1);
                const next = Math.round(
                    Math.max(80, Math.min(startWidth + delta * (align === "center" ? 2 : 1), max))
                );
                updateAttributes({ width: next });
            };
            const onUp = () => {
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
            };
            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
        },
        [align, updateAttributes]
    );

    if (!src) {
        return (
            <NodeViewWrapper className="ntn-media ntn-media--empty" data-type="image">
                {busy ? (
                    <div className="ntn-media__placeholder ntn-media__placeholder--static">
                        <Loader2 size={16} className="ntn-spin" /> <span>Uploading…</span>
                    </div>
                ) : (
                    <MediaPlaceholder
                        icon={ImageIcon}
                        label="Add an image"
                        accept="image/*"
                        editable={editable}
                        onFile={(file) => void upload(file)}
                        onUrl={(url) => updateAttributes({ src: url })}
                    />
                )}
            </NodeViewWrapper>
        );
    }

    const style: CSSProperties = {
        width: width ? `${width}px` : undefined,
        maxWidth: "100%",
    };

    return (
        <NodeViewWrapper
            className={`ntn-media ntn-media--image${selected ? " is-selected" : ""}`}
            data-align={align}
        >
            <figure className="ntn-media__figure" style={{ justifyContent: alignToFlex(align) }}>
                <div className="ntn-media__frame" ref={frameRef} style={style}>
                    {/* Sources are arbitrary user URLs, so next/image's loader
                        cannot be used here without an allowlist per host. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={src}
                        alt={(node.attrs.alt as string) ?? ""}
                        className="ntn-media__img"
                        draggable={false}
                    />
                    {editable && (
                        <>
                            <span
                                className="ntn-media__handle ntn-media__handle--left"
                                onPointerDown={(event) => startResize(event, "left")}
                            />
                            <span
                                className="ntn-media__handle ntn-media__handle--right"
                                onPointerDown={(event) => startResize(event, "right")}
                            />
                            <MediaToolbar
                                align={align}
                                onAlign={(value) => updateAttributes({ align: value })}
                                onDelete={deleteNode}
                                extra={
                                    <a
                                        className="ntn-media__tool"
                                        href={src}
                                        target="_blank"
                                        rel="noreferrer"
                                        title="Open original"
                                    >
                                        <ExternalLink size={13} />
                                    </a>
                                }
                            />
                        </>
                    )}
                </div>
            </figure>
            <Caption
                value={(node.attrs.caption as string) ?? ""}
                editable={editable}
                onChange={(caption) => updateAttributes({ caption })}
            />
        </NodeViewWrapper>
    );
}

function alignToFlex(align: string): string {
    if (align === "left") return "flex-start";
    if (align === "right") return "flex-end";
    return "center";
}

// ---------------------------------------------------------------------------
// Video / audio
// ---------------------------------------------------------------------------

export function VideoBlockView({
    node,
    updateAttributes,
    deleteNode,
    editor,
}: NodeViewProps) {
    const src = node.attrs.src as string | null;
    const editable = editor.isEditable;
    const { upload, busy } = useUpload((file) => updateAttributes({ src: file.url }));

    if (!src) {
        return (
            <NodeViewWrapper className="ntn-media ntn-media--empty" data-type="video">
                {busy ? (
                    <div className="ntn-media__placeholder ntn-media__placeholder--static">
                        <Loader2 size={16} className="ntn-spin" /> <span>Uploading…</span>
                    </div>
                ) : (
                    <MediaPlaceholder
                        icon={Video}
                        label="Add a video"
                        accept="video/*"
                        editable={editable}
                        onFile={(file) => void upload(file)}
                        onUrl={(url) => updateAttributes({ src: url })}
                    />
                )}
            </NodeViewWrapper>
        );
    }

    // A YouTube/Vimeo link cannot go in a <video> tag; route it through the
    // provider's iframe player instead of showing a broken element.
    const embed = embedUrlFor(src);

    return (
        <NodeViewWrapper className="ntn-media ntn-media--video">
            <figure className="ntn-media__figure">
                <div className="ntn-media__frame">
                    {embed ? (
                        <iframe
                            className="ntn-media__iframe"
                            src={embed}
                            title={(node.attrs.caption as string) || "Embedded video"}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
                            allowFullScreen
                        />
                    ) : (
                        <video className="ntn-media__video" src={src} controls />
                    )}
                    {editable && <MediaToolbar onDelete={deleteNode} />}
                </div>
            </figure>
            <Caption
                value={(node.attrs.caption as string) ?? ""}
                editable={editable}
                onChange={(caption) => updateAttributes({ caption })}
            />
        </NodeViewWrapper>
    );
}

export function AudioBlockView({
    node,
    updateAttributes,
    deleteNode,
    editor,
}: NodeViewProps) {
    const src = node.attrs.src as string | null;
    const editable = editor.isEditable;
    const { upload, busy } = useUpload((file) =>
        updateAttributes({ src: file.url, name: file.name })
    );

    if (!src) {
        return (
            <NodeViewWrapper className="ntn-media ntn-media--empty" data-type="audio">
                {busy ? (
                    <div className="ntn-media__placeholder ntn-media__placeholder--static">
                        <Loader2 size={16} className="ntn-spin" /> <span>Uploading…</span>
                    </div>
                ) : (
                    <MediaPlaceholder
                        icon={Music}
                        label="Add audio"
                        accept="audio/*"
                        editable={editable}
                        onFile={(file) => void upload(file)}
                        onUrl={(url) => updateAttributes({ src: url })}
                    />
                )}
            </NodeViewWrapper>
        );
    }

    return (
        <NodeViewWrapper className="ntn-media ntn-media--audio">
            <div className="ntn-media__frame ntn-media__frame--audio">
                <audio className="ntn-media__audio" src={src} controls />
                {editable && <MediaToolbar onDelete={deleteNode} />}
            </div>
            <Caption
                value={(node.attrs.caption as string) ?? ""}
                editable={editable}
                onChange={(caption) => updateAttributes({ caption })}
            />
        </NodeViewWrapper>
    );
}

// ---------------------------------------------------------------------------
// File
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
    if (!bytes) return "";
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function FileBlockView({
    node,
    updateAttributes,
    deleteNode,
    editor,
}: NodeViewProps) {
    const src = node.attrs.src as string | null;
    const editable = editor.isEditable;
    const { upload, busy } = useUpload((file) =>
        updateAttributes({
            src: file.url,
            name: file.name,
            size: file.size,
            contentType: file.contentType,
        })
    );

    if (!src) {
        return (
            <NodeViewWrapper className="ntn-media ntn-media--empty" data-type="file">
                {busy ? (
                    <div className="ntn-media__placeholder ntn-media__placeholder--static">
                        <Loader2 size={16} className="ntn-spin" /> <span>Uploading…</span>
                    </div>
                ) : (
                    <MediaPlaceholder
                        icon={FileIcon}
                        label="Add a file"
                        editable={editable}
                        onFile={(file) => void upload(file)}
                        onUrl={(url) =>
                            updateAttributes({ src: url, name: url.split("/").pop() ?? url })
                        }
                    />
                )}
            </NodeViewWrapper>
        );
    }

    const name = (node.attrs.name as string) || "File";
    const size = node.attrs.size as number | null;

    return (
        <NodeViewWrapper className="ntn-media ntn-media--file">
            <div className="ntn-file">
                <FileIcon size={16} className="ntn-file__icon" />
                <a className="ntn-file__name" href={src} target="_blank" rel="noreferrer">
                    {name}
                </a>
                {size ? <span className="ntn-file__size">{formatBytes(size)}</span> : null}
                <a className="ntn-file__action" href={src} download title="Download">
                    <Download size={13} />
                </a>
                {editable && (
                    <button
                        type="button"
                        className="ntn-file__action"
                        title="Delete"
                        onClick={deleteNode}
                    >
                        <Trash2 size={13} />
                    </button>
                )}
            </div>
        </NodeViewWrapper>
    );
}

// ---------------------------------------------------------------------------
// Bookmark
// ---------------------------------------------------------------------------

export function BookmarkView({
    node,
    updateAttributes,
    deleteNode,
    editor,
}: NodeViewProps) {
    const url = node.attrs.url as string | null;
    const editable = editor.isEditable;
    const { fetchBookmark } = useNotionEditor();
    const [loading, setLoading] = useState(false);

    // Metadata is fetched once and then stored on the node, so a reload does
    // not re-scrape and an offline page still shows its card.
    useEffect(() => {
        if (!url || node.attrs.title) return;
        let cancelled = false;
        setLoading(true);
        void fetchBookmark(url)
            .then((meta) => {
                if (cancelled || !meta) return;
                updateAttributes({
                    title: meta.title,
                    description: meta.description,
                    image: meta.image,
                    favicon: meta.favicon,
                    siteName: meta.siteName,
                });
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [url, node.attrs.title, fetchBookmark, updateAttributes]);

    if (!url) {
        return (
            <NodeViewWrapper className="ntn-media ntn-media--empty" data-type="bookmark">
                <MediaPlaceholder
                    icon={BookmarkIcon}
                    label="Add a web bookmark"
                    editable={editable}
                    allowUpload={false}
                    onFile={() => undefined}
                    onUrl={(next) => updateAttributes({ url: next })}
                />
            </NodeViewWrapper>
        );
    }

    const image = node.attrs.image as string | null;
    const favicon = node.attrs.favicon as string | null;

    return (
        <NodeViewWrapper className="ntn-media ntn-media--bookmark">
            <a className="ntn-bookmark" href={url} target="_blank" rel="noreferrer">
                <div className="ntn-bookmark__text">
                    <div className="ntn-bookmark__title">
                        {(node.attrs.title as string) || (loading ? "Loading…" : url)}
                    </div>
                    {node.attrs.description ? (
                        <div className="ntn-bookmark__desc">{node.attrs.description as string}</div>
                    ) : null}
                    <div className="ntn-bookmark__meta">
                        {favicon ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img className="ntn-bookmark__favicon" src={favicon} alt="" />
                        ) : null}
                        <span>{url}</span>
                    </div>
                </div>
                {image ? (
                    <div className="ntn-bookmark__image">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={image} alt="" />
                    </div>
                ) : null}
            </a>
            {editable && (
                <div className="ntn-media__toolbar ntn-media__toolbar--inline">
                    <button type="button" className="ntn-media__tool" title="Delete" onClick={deleteNode}>
                        <Trash2 size={13} />
                    </button>
                </div>
            )}
        </NodeViewWrapper>
    );
}

// ---------------------------------------------------------------------------
// Embed
// ---------------------------------------------------------------------------

export function EmbedBlockView({
    node,
    updateAttributes,
    deleteNode,
    editor,
}: NodeViewProps) {
    const url = node.attrs.url as string | null;
    const provider = node.attrs.provider as string | null;
    const height = (node.attrs.height as number) || 420;
    const editable = editor.isEditable;
    const frameRef = useRef<HTMLDivElement>(null);

    const startResize = useCallback(
        (event: React.PointerEvent) => {
            event.preventDefault();
            const startY = event.clientY;
            const startHeight = frameRef.current?.getBoundingClientRect().height ?? height;

            const onMove = (move: PointerEvent) => {
                const next = Math.round(
                    Math.max(160, Math.min(startHeight + (move.clientY - startY), 1200))
                );
                updateAttributes({ height: next });
            };
            const onUp = () => {
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
            };
            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
        },
        [height, updateAttributes]
    );

    if (!url) {
        return (
            <NodeViewWrapper className="ntn-media ntn-media--empty" data-type="embed">
                <MediaPlaceholder
                    icon={PanelTop}
                    label={provider ? `Add a ${providerLabel(provider)} link` : "Add an embed"}
                    editable={editable}
                    allowUpload={false}
                    onFile={() => undefined}
                    onUrl={(next) => updateAttributes({ url: next })}
                />
            </NodeViewWrapper>
        );
    }

    const embed = embedUrlFor(url) ?? url;

    return (
        <NodeViewWrapper className="ntn-media ntn-media--embed">
            <div className="ntn-media__frame" ref={frameRef} style={{ height }}>
                <iframe
                    className="ntn-media__iframe"
                    src={embed}
                    title={(node.attrs.caption as string) || providerLabel(provider ?? "embed")}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                    allowFullScreen
                    sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
                />
                {editable && (
                    <>
                        <MediaToolbar
                            onDelete={deleteNode}
                            extra={
                                <a
                                    className="ntn-media__tool"
                                    href={url}
                                    target="_blank"
                                    rel="noreferrer"
                                    title="Open original"
                                >
                                    <ExternalLink size={13} />
                                </a>
                            }
                        />
                        <span
                            className="ntn-media__handle ntn-media__handle--bottom"
                            onPointerDown={startResize}
                        />
                    </>
                )}
            </div>
            <Caption
                value={(node.attrs.caption as string) ?? ""}
                editable={editable}
                onChange={(caption) => updateAttributes({ caption })}
            />
        </NodeViewWrapper>
    );
}
