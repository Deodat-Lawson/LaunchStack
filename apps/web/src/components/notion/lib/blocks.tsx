"use client";

/**
 * The block catalogue.
 *
 * One table drives the slash menu, the "Turn into" menu, and the block-insert
 * (+) menu, because in Notion those three are the same list seen from
 * different angles. Each entry knows how to insert itself and, where the
 * conversion is meaningful, how to convert the current block into itself.
 */

import type { Editor } from "@tiptap/react";
import {
    AlignLeft,
    AtSign,
    Bookmark,
    Braces,
    CalendarDays,
    CaseSensitive,
    ChevronRight,
    Clock,
    Code2,
    Columns2,
    Columns3,
    Columns4,
    FileText,
    Film,
    FolderInput,
    Github,
    Heading1,
    Heading2,
    Heading3,
    Image as ImageIcon,
    Kanban,
    LayoutList,
    Link2,
    List,
    ListOrdered,
    ListTodo,
    type LucideIcon,
    Map as MapIcon,
    Minus,
    MousePointerClick,
    Music,
    Palette,
    PanelTop,
    Quote,
    RefreshCw,
    Rows3,
    Sigma,
    Smile,
    Table as TableIcon,
    Table2,
    Type,
    Users,
    Video,
} from "lucide-react";

/** Everything a block command may need that lives outside the editor. */
export interface BlockCommandContext {
    /** Create a child page and insert a link to it at the cursor. */
    createSubPage: () => Promise<void>;
    /** Open the "link to an existing page" picker. */
    linkToPage: () => void;
    /** Insert an inline or full database with the given starting view. */
    insertDatabase: (
        view: "table" | "board" | "list" | "gallery" | "calendar" | "timeline"
    ) => Promise<void>;
    /** Open the emoji picker for inline insertion. */
    pickEmoji: () => void;
    /** Open the inline mention menu pre-filtered to a kind. */
    mention: (kind: "page" | "person" | "date") => void;
    /** Start a comment on the current selection. */
    comment: () => void;
}

export type BlockGroup =
    | "suggested"
    | "basic"
    | "inline"
    | "media"
    | "database"
    | "embeds"
    | "advanced";

export const BLOCK_GROUP_LABELS: Record<BlockGroup, string> = {
    suggested: "Suggested",
    basic: "Basic blocks",
    inline: "Inline",
    media: "Media",
    database: "Database",
    embeds: "Embeds",
    advanced: "Advanced blocks",
};

export interface BlockDefinition {
    id: string;
    title: string;
    description: string;
    group: BlockGroup;
    icon: LucideIcon;
    /** Extra search terms, so "bullet" finds "Bulleted list". */
    keywords: string[];
    /**
     * Insert or convert at the cursor. Returns whatever the underlying chain
     * returns — callers ignore it, and typing it `unknown` keeps every entry
     * a one-liner.
     */
    run: (editor: Editor, ctx: BlockCommandContext) => unknown;
    /** Present when the block is a valid "Turn into" target. */
    turnInto?: (editor: Editor) => unknown;
    /** True when the current selection is already this block. */
    isActive?: (editor: Editor) => boolean;
    /** Shortcut hint shown on the right of the row. */
    shortcut?: string;
}

/**
 * Insert a node after the current block. Used by leaf blocks (images,
 * dividers, embeds) where "turn the paragraph into this" is not meaningful but
 * "put one here" is.
 */
function insertNode(
    editor: Editor,
    node: Record<string, unknown>,
    { replaceEmpty = true } = {}
): void {
    const { $from, empty } = editor.state.selection;
    const isEmptyParagraph =
        replaceEmpty &&
        empty &&
        $from.parent.type.name === "paragraph" &&
        $from.parent.content.size === 0;

    if (isEmptyParagraph) {
        editor
            .chain()
            .focus()
            .deleteRange({ from: $from.before(), to: $from.after() })
            .insertContent(node)
            .run();
        return;
    }
    editor.chain().focus().insertContent(node).run();
}

export const BLOCKS: BlockDefinition[] = [
    // -- Basic ------------------------------------------------------------
    {
        id: "text",
        title: "Text",
        description: "Just start writing with plain text.",
        group: "basic",
        icon: Type,
        keywords: ["paragraph", "plain", "p"],
        run: (editor) => editor.chain().focus().setParagraph().run(),
        turnInto: (editor) => editor.chain().focus().setParagraph().run(),
        isActive: (editor) => editor.isActive("paragraph"),
    },
    {
        id: "page",
        title: "Page",
        description: "Embed a sub-page inside this page.",
        group: "basic",
        icon: FileText,
        keywords: ["subpage", "child", "new"],
        run: (_editor, ctx) => ctx.createSubPage(),
    },
    {
        id: "todo",
        title: "To-do list",
        description: "Track tasks with a checkbox.",
        group: "basic",
        icon: ListTodo,
        keywords: ["checkbox", "task", "check", "todo"],
        shortcut: "[]",
        run: (editor) => editor.chain().focus().toggleTaskList().run(),
        turnInto: (editor) => editor.chain().focus().toggleTaskList().run(),
        isActive: (editor) => editor.isActive("taskItem"),
    },
    {
        id: "h1",
        title: "Heading 1",
        description: "Big section heading.",
        group: "basic",
        icon: Heading1,
        keywords: ["title", "large", "h1", "#"],
        shortcut: "#",
        run: (editor) => editor.chain().focus().setNode("heading", { level: 1 }).run(),
        turnInto: (editor) => editor.chain().focus().setNode("heading", { level: 1 }).run(),
        isActive: (editor) => editor.isActive("heading", { level: 1 }),
    },
    {
        id: "h2",
        title: "Heading 2",
        description: "Medium section heading.",
        group: "basic",
        icon: Heading2,
        keywords: ["subtitle", "medium", "h2", "##"],
        shortcut: "##",
        run: (editor) => editor.chain().focus().setNode("heading", { level: 2 }).run(),
        turnInto: (editor) => editor.chain().focus().setNode("heading", { level: 2 }).run(),
        isActive: (editor) => editor.isActive("heading", { level: 2 }),
    },
    {
        id: "h3",
        title: "Heading 3",
        description: "Small section heading.",
        group: "basic",
        icon: Heading3,
        keywords: ["subsection", "small", "h3", "###"],
        shortcut: "###",
        run: (editor) => editor.chain().focus().setNode("heading", { level: 3 }).run(),
        turnInto: (editor) => editor.chain().focus().setNode("heading", { level: 3 }).run(),
        isActive: (editor) => editor.isActive("heading", { level: 3 }),
    },
    {
        id: "bulleted",
        title: "Bulleted list",
        description: "Create a simple bulleted list.",
        group: "basic",
        icon: List,
        keywords: ["unordered", "point", "ul", "-"],
        shortcut: "-",
        run: (editor) => editor.chain().focus().toggleBulletList().run(),
        turnInto: (editor) => editor.chain().focus().toggleBulletList().run(),
        isActive: (editor) => editor.isActive("bulletList"),
    },
    {
        id: "numbered",
        title: "Numbered list",
        description: "Create a list with numbering.",
        group: "basic",
        icon: ListOrdered,
        keywords: ["ordered", "ol", "1."],
        shortcut: "1.",
        run: (editor) => editor.chain().focus().toggleOrderedList().run(),
        turnInto: (editor) => editor.chain().focus().toggleOrderedList().run(),
        isActive: (editor) => editor.isActive("orderedList"),
    },
    {
        id: "toggle",
        title: "Toggle list",
        description: "Toggles can hide and show content inside.",
        group: "basic",
        icon: ChevronRight,
        keywords: ["collapse", "collapsible", "details", "accordion", ">"],
        shortcut: ">",
        run: (editor) => editor.chain().focus().setToggle().run(),
        turnInto: (editor) => editor.chain().focus().setToggle().run(),
        isActive: (editor) => editor.isActive("details"),
    },
    {
        id: "code",
        title: "Code",
        description: "Capture a code snippet.",
        group: "basic",
        icon: Code2,
        keywords: ["snippet", "codeblock", "```", "pre"],
        shortcut: "```",
        run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
        turnInto: (editor) => editor.chain().focus().toggleCodeBlock().run(),
        isActive: (editor) => editor.isActive("codeBlock"),
    },
    {
        id: "quote",
        title: "Quote",
        description: "Capture a quote.",
        group: "basic",
        icon: Quote,
        keywords: ["blockquote", "citation", '"'],
        shortcut: '"',
        run: (editor) => editor.chain().focus().toggleBlockquote().run(),
        turnInto: (editor) => editor.chain().focus().toggleBlockquote().run(),
        isActive: (editor) => editor.isActive("blockquote"),
    },
    {
        id: "callout",
        title: "Callout",
        description: "Make writing stand out.",
        group: "basic",
        icon: AlignLeft,
        keywords: ["info", "note", "warning", "aside", "panel"],
        run: (editor) => editor.chain().focus().setCallout().run(),
        turnInto: (editor) => editor.chain().focus().setCallout().run(),
        isActive: (editor) => editor.isActive("callout"),
    },
    {
        id: "divider",
        title: "Divider",
        description: "Visually divide blocks.",
        group: "basic",
        icon: Minus,
        keywords: ["line", "separator", "hr", "---"],
        shortcut: "---",
        run: (editor) => editor.chain().focus().setHorizontalRule().run(),
    },
    {
        id: "block-equation",
        title: "Block equation",
        description: "Display a standalone LaTeX equation.",
        group: "basic",
        icon: Sigma,
        keywords: ["math", "latex", "katex", "formula", "$$"],
        run: (editor) =>
            insertNode(editor, { type: "blockMath", attrs: { latex: "" } }),
    },
    {
        id: "table",
        title: "Table",
        description: "Add a simple table to this page.",
        group: "basic",
        icon: TableIcon,
        keywords: ["grid", "spreadsheet", "rows", "columns"],
        run: (editor) =>
            editor
                .chain()
                .focus()
                .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                .run(),
    },
    {
        id: "link-to-page",
        title: "Link to page",
        description: "Link to an existing page.",
        group: "basic",
        icon: Link2,
        keywords: ["reference", "mention", "existing"],
        run: (_editor, ctx) => ctx.linkToPage(),
    },

    // -- Toggle headings ---------------------------------------------------
    ...([1, 2, 3] as const).map<BlockDefinition>((level) => ({
        id: `toggle-h${level}`,
        title: `Toggle heading ${level}`,
        description: `Collapsible heading ${level}.`,
        group: "basic",
        icon: level === 1 ? Heading1 : level === 2 ? Heading2 : Heading3,
        keywords: ["collapse", "toggle", "heading", `h${level}`],
        run: (editor) => editor.chain().focus().setToggle({ headingLevel: level }).run(),
        turnInto: (editor) =>
            editor.chain().focus().setToggle({ headingLevel: level }).run(),
        isActive: (editor) => editor.isActive("details", { headingLevel: level }),
    })),

    // -- Inline ------------------------------------------------------------
    {
        id: "mention-person",
        title: "Mention a person",
        description: "Mention someone and notify them.",
        group: "inline",
        icon: Users,
        keywords: ["@", "user", "people", "tag"],
        run: (_editor, ctx) => ctx.mention("person"),
    },
    {
        id: "mention-page",
        title: "Mention a page",
        description: "Link to a page inline.",
        group: "inline",
        icon: AtSign,
        keywords: ["@", "link", "reference"],
        run: (_editor, ctx) => ctx.mention("page"),
    },
    {
        id: "date",
        title: "Date or reminder",
        description: "Insert a date or a reminder.",
        group: "inline",
        icon: CalendarDays,
        keywords: ["today", "tomorrow", "remind", "time", "@"],
        run: (_editor, ctx) => ctx.mention("date"),
    },
    {
        id: "emoji",
        title: "Emoji",
        description: "Pick an emoji to insert.",
        group: "inline",
        icon: Smile,
        keywords: [":", "smiley", "icon", "reaction"],
        run: (_editor, ctx) => ctx.pickEmoji(),
    },
    {
        id: "inline-equation",
        title: "Inline equation",
        description: "Insert a LaTeX equation inline.",
        group: "inline",
        icon: Sigma,
        keywords: ["math", "latex", "formula", "$"],
        shortcut: "Ctrl+Shift+E",
        run: (editor) => editor.chain().focus().insertInlineMath({ latex: "" }).run(),
    },
    {
        id: "comment",
        title: "Comment",
        description: "Leave a comment on this block.",
        group: "inline",
        icon: MousePointerClick,
        keywords: ["annotate", "discuss", "feedback"],
        run: (_editor, ctx) => ctx.comment(),
    },

    // -- Media -------------------------------------------------------------
    {
        id: "image",
        title: "Image",
        description: "Upload or embed with a link.",
        group: "media",
        icon: ImageIcon,
        keywords: ["picture", "photo", "img", "upload"],
        run: (editor) =>
            insertNode(editor, { type: "imageBlock", attrs: { src: null } }),
    },
    {
        id: "video",
        title: "Video",
        description: "Embed from YouTube, Vimeo, or a file.",
        group: "media",
        icon: Video,
        keywords: ["youtube", "vimeo", "mp4", "movie"],
        run: (editor) =>
            insertNode(editor, { type: "videoBlock", attrs: { src: null } }),
    },
    {
        id: "audio",
        title: "Audio",
        description: "Embed a sound file or a track.",
        group: "media",
        icon: Music,
        keywords: ["sound", "mp3", "music", "podcast", "spotify"],
        run: (editor) =>
            insertNode(editor, { type: "audioBlock", attrs: { src: null } }),
    },
    {
        id: "file",
        title: "File",
        description: "Upload or embed any file.",
        group: "media",
        icon: FolderInput,
        keywords: ["attachment", "upload", "document", "pdf"],
        run: (editor) =>
            insertNode(editor, { type: "fileBlock", attrs: { src: null } }),
    },
    {
        id: "bookmark",
        title: "Web bookmark",
        description: "Save a link as a visual bookmark.",
        group: "media",
        icon: Bookmark,
        keywords: ["link", "url", "preview", "site"],
        run: (editor) =>
            insertNode(editor, { type: "bookmark", attrs: { url: null } }),
    },
    {
        id: "embed",
        title: "Embed",
        description: "Embed any site inside this page.",
        group: "media",
        icon: PanelTop,
        keywords: ["iframe", "site", "widget"],
        run: (editor) =>
            insertNode(editor, { type: "embedBlock", attrs: { url: null } }),
    },

    // -- Database ----------------------------------------------------------
    {
        id: "db-table",
        title: "Table view",
        description: "A database as a spreadsheet grid.",
        group: "database",
        icon: Table2,
        keywords: ["database", "grid", "rows"],
        run: (_editor, ctx) => ctx.insertDatabase("table"),
    },
    {
        id: "db-board",
        title: "Board view",
        description: "A kanban board grouped by a property.",
        group: "database",
        icon: Kanban,
        keywords: ["kanban", "database", "cards", "columns"],
        run: (_editor, ctx) => ctx.insertDatabase("board"),
    },
    {
        id: "db-list",
        title: "List view",
        description: "A simple list of database pages.",
        group: "database",
        icon: LayoutList,
        keywords: ["database", "simple"],
        run: (_editor, ctx) => ctx.insertDatabase("list"),
    },
    {
        id: "db-gallery",
        title: "Gallery view",
        description: "A grid of cards with previews.",
        group: "database",
        icon: Rows3,
        keywords: ["database", "cards", "grid", "images"],
        run: (_editor, ctx) => ctx.insertDatabase("gallery"),
    },
    {
        id: "db-calendar",
        title: "Calendar view",
        description: "A month calendar of database pages.",
        group: "database",
        icon: CalendarDays,
        keywords: ["database", "month", "schedule", "dates"],
        run: (_editor, ctx) => ctx.insertDatabase("calendar"),
    },
    {
        id: "db-timeline",
        title: "Timeline view",
        description: "A gantt-style timeline of database pages.",
        group: "database",
        icon: Clock,
        keywords: ["database", "gantt", "schedule", "roadmap"],
        run: (_editor, ctx) => ctx.insertDatabase("timeline"),
    },

    // -- Embeds ------------------------------------------------------------
    ...(
        [
            ["youtube", "YouTube", Video, ["video", "clip"]],
            ["figma", "Figma", Palette, ["design", "prototype"]],
            ["maps", "Google Maps", MapIcon, ["location", "map", "address"]],
            ["gist", "GitHub Gist", Github, ["code", "snippet", "git"]],
            ["pdf", "PDF", FileText, ["document", "paper"]],
            ["tweet", "Tweet", CaseSensitive, ["x", "twitter", "post"]],
            ["loom", "Loom", Film, ["screen", "recording", "video"]],
            ["codepen", "CodePen", Braces, ["code", "demo", "sandbox"]],
        ] as const
    ).map<BlockDefinition>(([id, title, icon, keywords]) => ({
        id: `embed-${id}`,
        title,
        description: `Embed a ${title} link.`,
        group: "embeds",
        icon,
        keywords: [...keywords, "embed"],
        run: (editor) =>
            insertNode(editor, {
                type: "embedBlock",
                attrs: { url: null, provider: id },
            }),
    })),

    // -- Advanced ----------------------------------------------------------
    {
        id: "toc",
        title: "Table of contents",
        description: "Jump to any heading on this page.",
        group: "advanced",
        icon: LayoutList,
        keywords: ["outline", "contents", "index", "toc", "navigation"],
        run: (editor) => insertNode(editor, { type: "tableOfContentsBlock" }),
    },
    {
        id: "breadcrumb",
        title: "Breadcrumb",
        description: "Show where this page sits in the tree.",
        group: "advanced",
        icon: ChevronRight,
        keywords: ["path", "navigation", "parent"],
        run: (editor) => insertNode(editor, { type: "breadcrumbBlock" }),
    },
    {
        id: "synced",
        title: "Synced block",
        description: "Mirror another page's content here.",
        group: "advanced",
        icon: RefreshCw,
        keywords: ["mirror", "reuse", "sync", "shared"],
        run: (editor) =>
            insertNode(editor, { type: "syncedBlock", attrs: { sourcePageId: null } }),
    },
    {
        id: "button",
        title: "Button",
        description: "A button that inserts blocks when clicked.",
        group: "advanced",
        icon: MousePointerClick,
        keywords: ["template", "action", "click", "repeat"],
        run: (editor) =>
            insertNode(editor, {
                type: "templateButton",
                attrs: { label: "New item" },
                content: [{ type: "paragraph" }],
            }),
    },
    ...([2, 3, 4, 5] as const).map<BlockDefinition>((count) => ({
        id: `columns-${count}`,
        title: `${count} columns`,
        description: `Split this section into ${count} columns.`,
        group: "advanced",
        icon: count === 2 ? Columns2 : count === 3 ? Columns3 : Columns4,
        keywords: ["column", "layout", "split", "grid", "side by side"],
        run: (editor) => editor.chain().focus().setColumns(count).run(),
    })),
];

/** Everything that can appear as a "Turn into" target, in Notion's order. */
export const TURN_INTO_BLOCKS = BLOCKS.filter((b) => b.turnInto !== undefined);

/**
 * Rank the catalogue against a slash-menu query. Exact title prefixes win over
 * word prefixes, which win over keyword hits — so `/co` offers Code before
 * Callout before "Colored text".
 */
export function searchBlocks(query: string, pool: BlockDefinition[] = BLOCKS): BlockDefinition[] {
    const q = query.trim().toLowerCase();
    if (!q) return pool;

    const scored: Array<{ block: BlockDefinition; score: number }> = [];
    for (const block of pool) {
        const title = block.title.toLowerCase();
        let score = -1;

        if (title === q) score = 100;
        else if (title.startsWith(q)) score = 80;
        else if (title.split(/\s+/).some((word) => word.startsWith(q))) score = 60;
        else if (title.includes(q)) score = 40;
        else if (block.keywords.some((k) => k.toLowerCase() === q)) score = 35;
        else if (block.keywords.some((k) => k.toLowerCase().startsWith(q))) score = 25;
        else if (block.description.toLowerCase().includes(q)) score = 10;

        if (score >= 0) scored.push({ block, score });
    }

    return scored
        .sort((a, b) => b.score - a.score || a.block.title.localeCompare(b.block.title))
        .map((s) => s.block);
}

/** Group blocks for display, preserving the catalogue's ordering. */
export function groupBlocks(
    blocks: BlockDefinition[]
): Array<{ group: BlockGroup; blocks: BlockDefinition[] }> {
    const order: BlockGroup[] = [
        "suggested",
        "basic",
        "inline",
        "media",
        "database",
        "embeds",
        "advanced",
    ];
    return order
        .map((group) => ({ group, blocks: blocks.filter((b) => b.group === group) }))
        .filter((section) => section.blocks.length > 0);
}
