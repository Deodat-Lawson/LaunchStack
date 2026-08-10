"use client";

/**
 * Table controls, shown while the caret is inside a table.
 *
 * Notion puts these on hover handles at the edge of each row and column; a
 * single toolbar covers the same commands without a second hit-testing plugin
 * fighting the drag handle for the gutter.
 */

import type { Editor } from "@tiptap/react";
import {
    ArrowDownToLine,
    ArrowLeftToLine,
    ArrowRightToLine,
    ArrowUpToLine,
    Combine,
    Heading,
    Split,
    Trash2,
} from "lucide-react";

export function TableToolbar({ editor }: { editor: Editor }) {
    if (!editor.isEditable || !editor.isActive("table")) return null;

    return (
        <div className="ntn-table-toolbar">
            <button
                type="button"
                className="ntn-table-toolbar__btn"
                title="Insert row above"
                onClick={() => editor.chain().focus().addRowBefore().run()}
            >
                <ArrowUpToLine size={14} />
            </button>
            <button
                type="button"
                className="ntn-table-toolbar__btn"
                title="Insert row below"
                onClick={() => editor.chain().focus().addRowAfter().run()}
            >
                <ArrowDownToLine size={14} />
            </button>
            <button
                type="button"
                className="ntn-table-toolbar__btn"
                title="Insert column left"
                onClick={() => editor.chain().focus().addColumnBefore().run()}
            >
                <ArrowLeftToLine size={14} />
            </button>
            <button
                type="button"
                className="ntn-table-toolbar__btn"
                title="Insert column right"
                onClick={() => editor.chain().focus().addColumnAfter().run()}
            >
                <ArrowRightToLine size={14} />
            </button>

            <span className="ntn-table-toolbar__sep" />

            <button
                type="button"
                className="ntn-table-toolbar__btn"
                title="Toggle header row"
                onClick={() => editor.chain().focus().toggleHeaderRow().run()}
            >
                <Heading size={14} />
            </button>
            <button
                type="button"
                className="ntn-table-toolbar__btn"
                title="Merge cells"
                onClick={() => editor.chain().focus().mergeCells().run()}
            >
                <Combine size={14} />
            </button>
            <button
                type="button"
                className="ntn-table-toolbar__btn"
                title="Split cell"
                onClick={() => editor.chain().focus().splitCell().run()}
            >
                <Split size={14} />
            </button>

            <span className="ntn-table-toolbar__sep" />

            <button
                type="button"
                className="ntn-table-toolbar__btn"
                title="Delete row"
                onClick={() => editor.chain().focus().deleteRow().run()}
            >
                <Trash2 size={14} />
                <span className="ntn-table-toolbar__label">Row</span>
            </button>
            <button
                type="button"
                className="ntn-table-toolbar__btn"
                title="Delete column"
                onClick={() => editor.chain().focus().deleteColumn().run()}
            >
                <Trash2 size={14} />
                <span className="ntn-table-toolbar__label">Column</span>
            </button>
            <button
                type="button"
                className="ntn-table-toolbar__btn is-danger"
                title="Delete table"
                onClick={() => editor.chain().focus().deleteTable().run()}
            >
                <Trash2 size={14} />
                <span className="ntn-table-toolbar__label">Table</span>
            </button>
        </div>
    );
}
