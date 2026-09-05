/**
 * Template metadata — the list, with no builders attached.
 *
 * Split out from `templates.ts` because two surfaces only ever need the names:
 * the Mindmap gallery and the workspace's "Add a source → Create" panel both
 * post a `templateId` and let the editor build the document on open. Importing
 * the full registry there would drag the shape library, palette and layout
 * engine into the Documents bundle for the sake of fifteen strings.
 *
 * `templates.ts` attaches a builder to every entry here; a unit test fails if
 * the two ever disagree.
 */

export type TemplateCategory = "Mindmap" | "Flowchart" | "Planning" | "Technical";

export interface TemplateMeta {
    id: string;
    name: string;
    description: string;
    category: TemplateCategory;
    /** Emoji shown on the gallery card. */
    glyph: string;
}

export const TEMPLATE_META: readonly TemplateMeta[] = [
    {
        id: "blank",
        name: "Blank canvas",
        description: "Start from nothing",
        category: "Mindmap",
        glyph: "▢",
    },
    {
        id: "mindmap",
        name: "Mindmap",
        description: "Central idea with radiating branches",
        category: "Mindmap",
        glyph: "🧠",
    },
    {
        id: "brainstorm",
        name: "Brainstorm board",
        description: "Sticky notes in four columns",
        category: "Mindmap",
        glyph: "💡",
    },
    {
        id: "concept-map",
        name: "Concept map",
        description: "Labelled relationships between ideas",
        category: "Mindmap",
        glyph: "🕸️",
    },
    {
        id: "flowchart",
        name: "Flowchart",
        description: "Start, steps, a decision and two outcomes",
        category: "Flowchart",
        glyph: "🔀",
    },
    {
        id: "user-flow",
        name: "User flow",
        description: "Screens and the paths between them",
        category: "Flowchart",
        glyph: "🧭",
    },
    {
        id: "swimlane",
        name: "Swimlane process",
        description: "Who does what, in lanes",
        category: "Flowchart",
        glyph: "🏊",
    },
    {
        id: "fishbone",
        name: "Cause and effect",
        description: "Ishikawa diagram for root-cause work",
        category: "Flowchart",
        glyph: "🐟",
    },
    {
        id: "org-chart",
        name: "Org chart",
        description: "Reporting lines, tidy-laid-out",
        category: "Planning",
        glyph: "🏢",
    },
    {
        id: "kanban",
        name: "Kanban board",
        description: "Four columns of cards",
        category: "Planning",
        glyph: "📋",
    },
    {
        id: "timeline",
        name: "Timeline",
        description: "Milestones along a spine",
        category: "Planning",
        glyph: "📅",
    },
    {
        id: "swot",
        name: "SWOT analysis",
        description: "Four framed quadrants",
        category: "Planning",
        glyph: "🎯",
    },
    {
        id: "customer-journey",
        name: "Customer journey",
        description: "Stages across actions, touchpoints, feelings",
        category: "Planning",
        glyph: "🚶",
    },
    {
        id: "architecture",
        name: "System architecture",
        description: "Services, stores and the calls between them",
        category: "Technical",
        glyph: "🏗️",
    },
    {
        id: "erd",
        name: "Entity relationship",
        description: "Tables with crow's-foot cardinality",
        category: "Technical",
        glyph: "🗄️",
    },
];

export const TEMPLATE_META_BY_ID: Record<string, TemplateMeta> = Object.fromEntries(
    TEMPLATE_META.map(t => [t.id, t])
);

export const TEMPLATE_CATEGORIES: readonly TemplateCategory[] = [
    "Mindmap",
    "Flowchart",
    "Planning",
    "Technical",
];
