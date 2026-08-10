"use client";

/**
 * The editor's extension list.
 *
 * Built by a factory rather than exported as a constant: the suggestion
 * plugins need a live view of the page tree and the command context, and an
 * extension array is fixed for the lifetime of the editor instance. The
 * factory closes over a getter so the array can be created once while the data
 * behind it keeps changing.
 */

import type { Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Emoji, gitHubEmojis } from "@tiptap/extension-emoji";
import FileHandler from "@tiptap/extension-file-handler";
import Highlight from "@tiptap/extension-highlight";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { BlockMath, InlineMath } from "@tiptap/extension-mathematics";
import { TableKit } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import {
    BackgroundColor,
    Color,
    FontFamily,
    TextStyle,
} from "@tiptap/extension-text-style";
import { UniqueID } from "@tiptap/extension-unique-id";
import { CharacterCount, Focus, Placeholder, Selection } from "@tiptap/extensions";

import { advancedExtensions } from "./advanced-set";
import { BlockAttributes } from "./block-attributes";
import { Callout } from "./callout";
import { createCommentMarkers } from "./comment-markers";
import { NotionCodeBlock } from "./code-block";
import { Column, Columns } from "./columns";
import { CommentMark } from "./comment-mark";
import { DatabaseBlock } from "./database-block";
import {
    AudioBlock,
    Bookmark,
    EmbedBlock,
    FileBlock,
    ImageBlock,
    VideoBlock,
} from "./media";
import { NotionMention } from "./mention";
import {
    createEmojiSuggestion,
    createMentionSuggestion,
    createSlashCommand,
    type SuggestionRuntime,
} from "./suggestions";
import {
    NotionDetails,
    NotionDetailsContent,
    NotionDetailsSummary,
} from "./toggle";

export interface BuildExtensionsOptions {
    getRuntime: () => SuggestionRuntime;
    /** Blocks with an unresolved thread, re-read on every decoration pass. */
    getCommentedBlockIds: () => Set<string>;
    /** Called when a file is dropped or pasted into the document. */
    onFileDrop: (files: File[], pos: number | null) => void;
}

/** Notion's per-block hints. An empty paragraph only prompts when focused. */
function placeholderFor({
    node,
    hasAnchor,
}: {
    node: { type: { name: string }; attrs: Record<string, unknown> };
    hasAnchor: boolean;
}): string {
    switch (node.type.name) {
        case "heading": {
            const level = Number(node.attrs.level ?? 1);
            return `Heading ${level}`;
        }
        case "taskItem":
            return "To-do";
        case "listItem":
            return "List";
        case "blockquote":
            return "Empty quote";
        case "codeBlock":
            return "";
        case "detailsSummary":
            return "Toggle";
        case "paragraph":
            return hasAnchor ? "Write something, or press ‘/’ for commands…" : "";
        default:
            return "";
    }
}

export function buildExtensions({
    getRuntime,
    getCommentedBlockIds,
    onFileDrop,
}: BuildExtensionsOptions): Extensions {
    return [
        StarterKit.configure({
            // Replaced by the lowlight version with a language picker.
            codeBlock: false,
            heading: { levels: [1, 2, 3] },
            link: {
                openOnClick: false,
                autolink: true,
                defaultProtocol: "https",
                HTMLAttributes: { class: "ntn-link", rel: "noopener noreferrer" },
            },
            horizontalRule: { HTMLAttributes: { class: "ntn-divider" } },
            blockquote: { HTMLAttributes: { class: "ntn-quote" } },
            bulletList: { HTMLAttributes: { class: "ntn-list ntn-list--bullet" } },
            orderedList: { HTMLAttributes: { class: "ntn-list ntn-list--ordered" } },
            // Supplied below with the editor-specific configuration.
            dropcursor: { color: "var(--accent)", width: 2 },
            trailingNode: false,
        }),

        NotionCodeBlock,

        TaskList.configure({ HTMLAttributes: { class: "ntn-list ntn-list--task" } }),
        TaskItem.configure({ nested: true, HTMLAttributes: { class: "ntn-task" } }),

        TextStyle,
        Color,
        BackgroundColor,
        FontFamily,
        Highlight.configure({ multicolor: true }),
        TextAlign.configure({ types: ["heading", "paragraph"] }),

        TableKit.configure({
            table: { resizable: true, HTMLAttributes: { class: "ntn-table" } },
            tableCell: { HTMLAttributes: { class: "ntn-table__cell" } },
            tableHeader: { HTMLAttributes: { class: "ntn-table__header" } },
        }),

        Callout,
        Columns,
        Column,
        NotionDetails,
        NotionDetailsSummary,
        NotionDetailsContent,
        BlockAttributes,
        CommentMark,

        ImageBlock,
        VideoBlock,
        AudioBlock,
        FileBlock,
        Bookmark,
        EmbedBlock,
        DatabaseBlock,
        ...advancedExtensions,

        InlineMath,
        BlockMath,

        NotionMention.configure({
            HTMLAttributes: { class: "ntn-mention" },
            suggestion: createMentionSuggestion(getRuntime),
        }),

        Emoji.configure({
            emojis: gitHubEmojis,
            enableEmoticons: true,
            suggestion: createEmojiSuggestion(),
        }),

        createSlashCommand(getRuntime),
        createCommentMarkers(getCommentedBlockIds),

        // Stable per-block ids: comments anchor to them and the drag handle
        // uses them to identify what it is moving.
        UniqueID.configure({
            types: [
                "paragraph",
                "heading",
                "blockquote",
                "codeBlock",
                "bulletList",
                "orderedList",
                "taskList",
                "listItem",
                "taskItem",
                "callout",
                "details",
                "columns",
                "column",
                "imageBlock",
                "videoBlock",
                "audioBlock",
                "fileBlock",
                "bookmark",
                "embedBlock",
                "pageLink",
                "syncedBlock",
                "templateButton",
                "databaseBlock",
                "table",
                "blockMath",
                "horizontalRule",
                "tableOfContentsBlock",
                "breadcrumbBlock",
            ],
        }),

        Placeholder.configure({
            includeChildren: true,
            showOnlyCurrent: false,
            placeholder: placeholderFor,
            emptyEditorClass: "is-editor-empty",
            emptyNodeClass: "is-empty",
        }),

        Focus.configure({ className: "has-focus", mode: "shallowest" }),
        Selection,
        CharacterCount,

        FileHandler.configure({
            allowedMimeTypes: [],
            onDrop: (_editor, files, pos) => onFileDrop(files, pos),
            onPaste: (_editor, files) => onFileDrop(files, null),
        }),
    ];
}
