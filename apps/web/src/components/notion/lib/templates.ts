/**
 * Built-in page templates.
 *
 * Notion offers these from the blank-page starter row, and they matter more
 * than they look: a blank page is the moment people bounce. Each template is a
 * plain ProseMirror document, so applying one is a `setContent` rather than a
 * special code path.
 */

export interface PageTemplate {
    id: string;
    name: string;
    description: string;
    icon: string;
    /** Suggested page title; the user can overwrite it immediately. */
    title: string;
    /** ProseMirror document body. */
    content: Record<string, unknown>;
}

const paragraph = (text?: string): Record<string, unknown> =>
    text
        ? { type: "paragraph", content: [{ type: "text", text }] }
        : { type: "paragraph" };

const heading = (level: number, text: string): Record<string, unknown> => ({
    type: "heading",
    attrs: { level },
    content: [{ type: "text", text }],
});

const bullets = (items: string[]): Record<string, unknown> => ({
    type: "bulletList",
    content: items.map((item) => ({
        type: "listItem",
        content: [paragraph(item)],
    })),
});

const todos = (items: string[]): Record<string, unknown> => ({
    type: "taskList",
    content: items.map((item) => ({
        type: "taskItem",
        attrs: { checked: false },
        content: [paragraph(item)],
    })),
});

const callout = (emoji: string, color: string, text: string): Record<string, unknown> => ({
    type: "callout",
    attrs: { emoji, color },
    content: [paragraph(text)],
});

const divider = (): Record<string, unknown> => ({ type: "horizontalRule" });

const doc = (...content: Array<Record<string, unknown>>): Record<string, unknown> => ({
    type: "doc",
    content,
});

const table = (rows: string[][]): Record<string, unknown> => ({
    type: "table",
    content: rows.map((cells, rowIndex) => ({
        type: "tableRow",
        content: cells.map((cell) => ({
            type: rowIndex === 0 ? "tableHeader" : "tableCell",
            content: [paragraph(cell)],
        })),
    })),
});

export const PAGE_TEMPLATES: PageTemplate[] = [
    {
        id: "meeting-notes",
        name: "Meeting notes",
        description: "Attendees, agenda, decisions, and action items.",
        icon: "🗓️",
        title: "Meeting notes",
        content: doc(
            callout("🗓️", "blue", "Date · Attendees · Meeting owner"),
            heading(2, "Agenda"),
            bullets(["Topic one", "Topic two", "Topic three"]),
            heading(2, "Notes"),
            paragraph(),
            heading(2, "Decisions"),
            bullets(["Decision and its owner"]),
            heading(2, "Action items"),
            todos(["Follow up on …", "Send the summary"])
        ),
    },
    {
        id: "project-plan",
        name: "Project plan",
        description: "Goal, scope, milestones, and risks.",
        icon: "🚀",
        title: "Project plan",
        content: doc(
            callout("🎯", "purple", "What does done look like?"),
            heading(2, "Goal"),
            paragraph(),
            heading(2, "Scope"),
            bullets(["In scope", "Out of scope"]),
            heading(2, "Milestones"),
            table([
                ["Milestone", "Owner", "Date"],
                ["Kickoff", "", ""],
                ["Beta", "", ""],
                ["Launch", "", ""],
            ]),
            heading(2, "Risks"),
            bullets(["Risk and its mitigation"])
        ),
    },
    {
        id: "todo",
        name: "To-do list",
        description: "A simple checklist, grouped by when.",
        icon: "✅",
        title: "To-do",
        content: doc(
            heading(2, "Today"),
            todos(["", ""]),
            heading(2, "This week"),
            todos([""]),
            heading(2, "Later"),
            todos([""])
        ),
    },
    {
        id: "weekly-agenda",
        name: "Weekly agenda",
        description: "One section per day, with a review at the end.",
        icon: "📅",
        title: "Weekly agenda",
        content: doc(
            ...["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].flatMap((day) => [
                heading(3, day),
                todos([""]),
            ]),
            divider(),
            heading(2, "Review"),
            paragraph("What went well, what to change.")
        ),
    },
    {
        id: "doc",
        name: "Document",
        description: "A structured write-up with a summary and sections.",
        icon: "📄",
        title: "Untitled document",
        content: doc(
            callout("💡", "gray", "One-paragraph summary of this document."),
            heading(2, "Background"),
            paragraph(),
            heading(2, "Proposal"),
            paragraph(),
            heading(2, "Open questions"),
            bullets([""]),
            { type: "tableOfContentsBlock" }
        ),
    },
    {
        id: "journal",
        name: "Journal entry",
        description: "A dated entry with highlights and reflections.",
        icon: "📔",
        title: "Journal",
        content: doc(
            heading(2, "Highlights"),
            bullets([""]),
            heading(2, "What I learned"),
            paragraph(),
            heading(2, "Tomorrow"),
            todos([""])
        ),
    },
];
