"use client";

/**
 * The page's ••• menu.
 *
 * Notion packs style, width, lock, and every page-level action into one
 * dropdown; this mirrors that, including the word/character counts at the
 * bottom that the real one shows under "Page info".
 */

import type { Editor } from "@tiptap/react";
import {
    ArrowRight,
    Clock,
    Copy,
    Download,
    FileText,
    Link2,
    Lock,
    Maximize2,
    Star,
    Trash2,
    Type,
    Unlock,
} from "lucide-react";

import { MenuDivider, MenuHeading, MenuItem } from "../ui/Popover";
import type { WorkspacePageDto } from "~/types/workspace";

export interface PageMenuProps {
    page: WorkspacePageDto;
    editor: Editor | null;
    onPatch: (patch: Partial<WorkspacePageDto>) => void;
    onDuplicate: () => void;
    onMove: () => void;
    onTrash: () => void;
    onHistory: () => void;
    onExport: (format: "markdown" | "html" | "text") => void;
    onCopyLink: () => void;
    onClose: () => void;
}

const FONTS: Array<{ id: "default" | "serif" | "mono"; label: string; sample: string }> = [
    { id: "default", label: "Default", sample: "Ag" },
    { id: "serif", label: "Serif", sample: "Ag" },
    { id: "mono", label: "Mono", sample: "Ag" },
];

export function PageMenu({
    page,
    editor,
    onPatch,
    onDuplicate,
    onMove,
    onTrash,
    onHistory,
    onExport,
    onCopyLink,
    onClose,
}: PageMenuProps) {
    const characters = editor?.storage.characterCount?.characters?.() ?? 0;
    const words = editor?.storage.characterCount?.words?.() ?? 0;

    const act = (fn: () => void) => () => {
        fn();
        onClose();
    };

    return (
        <div className="ntn-menu ntn-menu--page">
            <div className="ntn-fontrow">
                {FONTS.map((font) => (
                    <button
                        key={font.id}
                        type="button"
                        className={`ntn-fontrow__item${page.font === font.id ? " is-active" : ""}`}
                        data-font={font.id}
                        onClick={() => onPatch({ font: font.id })}
                    >
                        <span className="ntn-fontrow__sample">{font.sample}</span>
                        <span className="ntn-fontrow__label">{font.label}</span>
                    </button>
                ))}
            </div>

            <MenuDivider />

            <ToggleRow
                icon={<Type size={15} />}
                label="Small text"
                on={page.smallText}
                onToggle={() => onPatch({ smallText: !page.smallText })}
            />
            <ToggleRow
                icon={<Maximize2 size={15} />}
                label="Full width"
                on={page.fullWidth}
                onToggle={() => onPatch({ fullWidth: !page.fullWidth })}
            />
            <ToggleRow
                icon={page.locked ? <Lock size={15} /> : <Unlock size={15} />}
                label="Lock page"
                on={page.locked}
                onToggle={() => onPatch({ locked: !page.locked })}
            />

            <MenuDivider />

            <MenuItem
                icon={<Star size={15} />}
                label={page.isFavorite ? "Remove from favourites" : "Add to favourites"}
                onClick={act(() => onPatch({ isFavorite: !page.isFavorite }))}
            />
            <MenuItem
                icon={<Link2 size={15} />}
                label="Copy link"
                hint="⌘L"
                onClick={act(onCopyLink)}
            />
            <MenuItem
                icon={<Copy size={15} />}
                label="Duplicate"
                hint="⌘D"
                onClick={act(onDuplicate)}
            />
            <MenuItem
                icon={<ArrowRight size={15} />}
                label="Move to"
                hint="⌘⇧P"
                onClick={act(onMove)}
            />
            <MenuItem
                icon={<Trash2 size={15} />}
                label="Move to trash"
                danger
                onClick={act(onTrash)}
            />

            <MenuDivider />

            <MenuItem
                icon={<Clock size={15} />}
                label="Page history"
                onClick={act(onHistory)}
            />
            <MenuHeading>Export</MenuHeading>
            <MenuItem
                icon={<Download size={15} />}
                label="Markdown"
                onClick={act(() => onExport("markdown"))}
            />
            <MenuItem
                icon={<FileText size={15} />}
                label="HTML"
                onClick={act(() => onExport("html"))}
            />
            <MenuItem
                icon={<FileText size={15} />}
                label="Plain text"
                onClick={act(() => onExport("text"))}
            />

            <MenuDivider />

            <div className="ntn-menu__info">
                <div>
                    <span>Word count</span>
                    <span>{words.toLocaleString()}</span>
                </div>
                <div>
                    <span>Characters</span>
                    <span>{characters.toLocaleString()}</span>
                </div>
                <div>
                    <span>Last edited</span>
                    <span>{new Date(page.updatedAt).toLocaleString()}</span>
                </div>
                <div>
                    <span>Created</span>
                    <span>{new Date(page.createdAt).toLocaleDateString()}</span>
                </div>
            </div>
        </div>
    );
}

function ToggleRow({
    icon,
    label,
    on,
    onToggle,
}: {
    icon: React.ReactNode;
    label: string;
    on: boolean;
    onToggle: () => void;
}) {
    return (
        <button type="button" className="ntn-menu__item" onClick={onToggle}>
            <span className="ntn-menu__icon">{icon}</span>
            <span className="ntn-menu__text">
                <span className="ntn-menu__title">{label}</span>
            </span>
            <span className={`ntn-toggle-switch${on ? " is-on" : ""}`}>
                <span />
            </span>
        </button>
    );
}
