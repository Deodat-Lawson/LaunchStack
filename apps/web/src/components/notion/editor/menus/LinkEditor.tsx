"use client";

/**
 * Link editor.
 *
 * Notion's link popover does two jobs: paste a URL, or search the workspace
 * and link to a page. Both end up as a link mark — an internal one uses the
 * `page://` scheme so navigation stays inside the app.
 */

import type { Editor } from "@tiptap/react";
import { ExternalLink, FileText, Link2, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { useNotionEditor } from "../../context";
import { MenuDivider, MenuHeading, MenuItem } from "../../ui/Popover";

export function LinkEditor({
    editor,
    onDone,
}: {
    editor: Editor;
    onDone: () => void;
}) {
    const { pages } = useNotionEditor();
    const existing = (editor.getAttributes("link").href as string) ?? "";
    const [value, setValue] = useState(existing);

    const matches = useMemo(() => {
        const q = value.trim().toLowerCase();
        // A typed URL is a URL, not a page search.
        if (/^https?:\/\//i.test(q) || q.startsWith("page://")) return [];
        return pages
            .filter((page) => !page.inTrash)
            .filter((page) => !q || (page.title || "Untitled").toLowerCase().includes(q))
            .slice(0, 6);
    }, [pages, value]);

    const applyHref = (href: string) => {
        if (!href) {
            editor.chain().focus().unsetLink().run();
        } else {
            editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
        }
        onDone();
    };

    return (
        <div className="ntn-menu ntn-menu--link">
            <form
                className="ntn-link-editor__form"
                onSubmit={(event) => {
                    event.preventDefault();
                    const trimmed = value.trim();
                    if (!trimmed) return;
                    applyHref(
                        /^[a-z][\w+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
                    );
                }}
            >
                <Link2 size={14} className="ntn-link-editor__icon" />
                <input
                    className="ntn-input ntn-input--flush"
                    placeholder="Paste a link or search pages…"
                    value={value}
                    autoFocus
                    onChange={(event) => setValue(event.target.value)}
                />
            </form>

            {matches.length > 0 && (
                <>
                    <MenuHeading>Link to page</MenuHeading>
                    {matches.map((page) => (
                        <MenuItem
                            key={page.id}
                            icon={
                                page.icon?.type === "emoji" ? (
                                    <span>{page.icon.value}</span>
                                ) : (
                                    <FileText size={15} />
                                )
                            }
                            label={page.title || "Untitled"}
                            onClick={() => applyHref(`page://${page.id}`)}
                        />
                    ))}
                </>
            )}

            {existing && (
                <>
                    <MenuDivider />
                    <MenuItem
                        icon={<ExternalLink size={15} />}
                        label="Open link"
                        onClick={() => {
                            if (existing.startsWith("page://")) {
                                onDone();
                                return;
                            }
                            window.open(existing, "_blank", "noopener,noreferrer");
                            onDone();
                        }}
                    />
                    <MenuItem
                        icon={<Trash2 size={15} />}
                        label="Remove link"
                        danger
                        onClick={() => applyHref("")}
                    />
                </>
            )}
        </div>
    );
}
