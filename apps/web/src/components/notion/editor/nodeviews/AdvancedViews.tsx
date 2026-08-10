"use client";

/**
 * Node views for the structural blocks: child/linked pages, table of
 * contents, breadcrumb, synced blocks, and template buttons.
 *
 * What they have in common is that they read from outside the document —
 * the page tree, the heading list, another page's body — which is why they
 * all go through the editor context rather than holding their own state.
 */

import {
    NodeViewContent,
    NodeViewWrapper,
    type NodeViewProps,
} from "@tiptap/react";
import {
    ChevronRight,
    FileText,
    Link as LinkIcon,
    Loader2,
    MousePointerClick,
    Plus,
    RefreshCw,
    Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { attrText } from "~/lib/prosemirror-attrs";
import { useNotionEditor } from "../../context";
import { RenderDoc } from "../../lib/render";
import type { PageIcon, WorkspacePageDto } from "~/types/workspace";

function IconGlyph({ icon, fallback = "📄" }: { icon: PageIcon | null; fallback?: string }) {
    if (icon?.type === "image") {
        // eslint-disable-next-line @next/next/no-img-element
        return <img className="ntn-icon-img" src={icon.value} alt="" />;
    }
    return <span>{icon?.value ?? fallback}</span>;
}

// ---------------------------------------------------------------------------
// Page link (child page / link to page)
// ---------------------------------------------------------------------------

export function PageLinkView({ node, editor, deleteNode }: NodeViewProps) {
    const { getPageSummary, navigateToPage } = useNotionEditor();
    const pageId = node.attrs.pageId as string | null;
    // Prefer the live tree over the stored copy so a rename is reflected
    // everywhere the page is linked, as it is in Notion.
    const summary = pageId ? getPageSummary(pageId) : undefined;
    // A blank title is as good as no title here, so fall through on "" too.
    const title =
        attrText(summary?.title, node.attrs.title) || "Untitled";
    const icon = summary?.icon ?? (node.attrs.icon as PageIcon | null) ?? null;
    const isLink = Boolean(node.attrs.isLink);

    return (
        <NodeViewWrapper className="ntn-page-link-wrap">
            <div
                className="ntn-page-link"
                role="link"
                tabIndex={0}
                onClick={() => pageId && navigateToPage(pageId)}
                onKeyDown={(event) => {
                    if (event.key === "Enter" && pageId) navigateToPage(pageId);
                }}
            >
                <span className="ntn-page-link__icon">
                    <IconGlyph icon={icon} fallback={isLink ? "🔗" : "📄"} />
                </span>
                <span className="ntn-page-link__title">{title}</span>
                {isLink && <LinkIcon size={12} className="ntn-page-link__badge" />}
                {!summary && pageId && (
                    <span className="ntn-page-link__missing">deleted</span>
                )}
                {editor.isEditable && (
                    <button
                        type="button"
                        className="ntn-page-link__remove"
                        title="Remove"
                        onClick={(event) => {
                            event.stopPropagation();
                            deleteNode();
                        }}
                    >
                        <Trash2 size={12} />
                    </button>
                )}
            </div>
        </NodeViewWrapper>
    );
}

// ---------------------------------------------------------------------------
// Table of contents
// ---------------------------------------------------------------------------

interface Heading {
    id: string;
    level: number;
    text: string;
    pos: number;
}

export function TableOfContentsView({ editor }: NodeViewProps) {
    const [headings, setHeadings] = useState<Heading[]>([]);

    // Recomputed on every doc change: a table of contents that lags behind the
    // headings it indexes is worse than none.
    useEffect(() => {
        const collect = () => {
            const found: Heading[] = [];
            editor.state.doc.descendants((node, pos) => {
                if (node.type.name !== "heading") return;
                found.push({
                    id: (node.attrs.id as string) ?? `h-${pos}`,
                    level: Number(node.attrs.level ?? 1),
                    text: node.textContent,
                    pos,
                });
            });
            setHeadings(found);
        };
        collect();
        editor.on("update", collect);
        return () => {
            editor.off("update", collect);
        };
    }, [editor]);

    return (
        <NodeViewWrapper className="ntn-toc" contentEditable={false}>
            {headings.length === 0 ? (
                <div className="ntn-toc__empty">Add headings to create a table of contents.</div>
            ) : (
                headings.map((heading) => (
                    <button
                        key={`${heading.id}-${heading.pos}`}
                        type="button"
                        className="ntn-toc__item"
                        data-level={heading.level}
                        onClick={() => {
                            editor.chain().focus().setTextSelection(heading.pos + 1).run();
                            editor.view.dom
                                .querySelector(`[data-id="${heading.id}"]`)
                                ?.scrollIntoView({ behavior: "smooth", block: "center" });
                        }}
                    >
                        {heading.text || "Untitled section"}
                    </button>
                ))
            )}
        </NodeViewWrapper>
    );
}

// ---------------------------------------------------------------------------
// Breadcrumb
// ---------------------------------------------------------------------------

export function BreadcrumbView() {
    const { breadcrumb, navigateToPage } = useNotionEditor();

    return (
        <NodeViewWrapper className="ntn-breadcrumb-block" contentEditable={false}>
            {breadcrumb.length === 0 ? (
                <span className="ntn-breadcrumb-block__empty">Private</span>
            ) : (
                breadcrumb.map((crumb, index) => (
                    <span key={crumb.id} className="ntn-breadcrumb-block__item">
                        {index > 0 && <ChevronRight size={12} className="ntn-breadcrumb-block__sep" />}
                        <button type="button" onClick={() => navigateToPage(crumb.id)}>
                            <IconGlyph icon={crumb.icon} />
                            <span>{crumb.title || "Untitled"}</span>
                        </button>
                    </span>
                ))
            )}
        </NodeViewWrapper>
    );
}

// ---------------------------------------------------------------------------
// Synced block
// ---------------------------------------------------------------------------

export function SyncedBlockView({ node, updateAttributes, editor, deleteNode }: NodeViewProps) {
    const { pages, navigateToPage, getPageSummary } = useNotionEditor();
    const sourcePageId = node.attrs.sourcePageId as string | null;
    const [source, setSource] = useState<WorkspacePageDto | null>(null);
    const [loading, setLoading] = useState(false);
    const [query, setQuery] = useState("");

    useEffect(() => {
        if (!sourcePageId) {
            setSource(null);
            return;
        }
        let cancelled = false;
        setLoading(true);
        void fetch(`/api/workspace/pages/${sourcePageId}?meta=false`)
            .then((response) => (response.ok ? response.json() : null))
            .then((data: { page?: WorkspacePageDto } | null) => {
                if (!cancelled) setSource(data?.page ?? null);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [sourcePageId]);

    const candidates = useMemo(() => {
        const q = query.trim().toLowerCase();
        return pages
            .filter((page) => !page.inTrash)
            .filter((page) => !q || page.title.toLowerCase().includes(q))
            .slice(0, 12);
    }, [pages, query]);

    if (!sourcePageId) {
        return (
            <NodeViewWrapper className="ntn-synced ntn-synced--empty">
                <div className="ntn-synced__head">
                    <RefreshCw size={13} />
                    <span>Pick a page to mirror here</span>
                    {editor.isEditable && (
                        <button type="button" className="ntn-synced__remove" onClick={deleteNode}>
                            <Trash2 size={12} />
                        </button>
                    )}
                </div>
                <input
                    className="ntn-input"
                    placeholder="Search pages…"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                />
                <div className="ntn-synced__list">
                    {candidates.map((page) => (
                        <button
                            key={page.id}
                            type="button"
                            className="ntn-synced__option"
                            onClick={() => updateAttributes({ sourcePageId: page.id })}
                        >
                            <IconGlyph icon={page.icon} />
                            <span>{page.title || "Untitled"}</span>
                        </button>
                    ))}
                    {candidates.length === 0 && (
                        <div className="ntn-synced__none">No pages found.</div>
                    )}
                </div>
            </NodeViewWrapper>
        );
    }

    const summary = getPageSummary(sourcePageId);

    return (
        <NodeViewWrapper className="ntn-synced">
            <div className="ntn-synced__head" contentEditable={false}>
                <RefreshCw size={12} />
                <button
                    type="button"
                    className="ntn-synced__origin"
                    onClick={() => navigateToPage(sourcePageId)}
                >
                    Synced from{" "}
                    {attrText(summary?.title, source?.title) || "another page"}
                </button>
                {editor.isEditable && (
                    <button type="button" className="ntn-synced__remove" onClick={deleteNode}>
                        <Trash2 size={12} />
                    </button>
                )}
            </div>
            <div className="ntn-synced__body" contentEditable={false}>
                {loading ? (
                    <div className="ntn-synced__loading">
                        <Loader2 size={14} className="ntn-spin" /> Loading…
                    </div>
                ) : source ? (
                    <RenderDoc doc={source.content} className="ntn-prose ntn-prose--embedded" />
                ) : (
                    <div className="ntn-synced__none">That page is no longer available.</div>
                )}
            </div>
        </NodeViewWrapper>
    );
}

// ---------------------------------------------------------------------------
// Template button
// ---------------------------------------------------------------------------

export function TemplateButtonView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
    const [editing, setEditing] = useState(false);
    const label = attrText(node.attrs.label) || "New item";

    /**
     * Clicking the button copies its template blocks below it, which is the
     * whole point of the block — the template itself stays put.
     */
    const run = () => {
        const pos = getPos();
        if (typeof pos !== "number") return;
        const template = node.toJSON() as { content?: unknown[] };
        const blocks = (template.content ?? []) as never[];
        if (blocks.length === 0) return;
        editor
            .chain()
            .focus()
            .insertContentAt(pos + node.nodeSize, blocks)
            .run();
    };

    if (editing && editor.isEditable) {
        return (
            <NodeViewWrapper className="ntn-template ntn-template--editing">
                <div className="ntn-template__bar" contentEditable={false}>
                    <MousePointerClick size={13} />
                    <input
                        className="ntn-input ntn-input--flush"
                        value={label}
                        autoFocus
                        onChange={(event) => updateAttributes({ label: event.target.value })}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") setEditing(false);
                        }}
                    />
                    <button type="button" className="ntn-btn" onClick={() => setEditing(false)}>
                        Done
                    </button>
                </div>
                <div className="ntn-template__hint" contentEditable={false}>
                    Blocks below are duplicated each time the button is clicked.
                </div>
                <NodeViewContent className="ntn-template__body" />
            </NodeViewWrapper>
        );
    }

    return (
        <NodeViewWrapper className="ntn-template">
            <div className="ntn-template__row" contentEditable={false}>
                <button type="button" className="ntn-template__button" onClick={run}>
                    <Plus size={13} />
                    <span>{label}</span>
                </button>
                {editor.isEditable && (
                    <button
                        type="button"
                        className="ntn-template__configure"
                        onClick={() => setEditing(true)}
                    >
                        Configure
                    </button>
                )}
            </div>
            {/* The template body stays in the document but is hidden until
                configured, mirroring how Notion tucks it away. */}
            <div className="ntn-template__hidden">
                <NodeViewContent />
            </div>
        </NodeViewWrapper>
    );
}

export { FileText };
