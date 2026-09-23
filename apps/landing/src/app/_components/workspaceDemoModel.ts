export const SAMPLE_SOURCES = [
    {
        id: "discovery",
        title: "Customer discovery",
        detail: "8 interview notes",
        kind: "Audio",
        quote: "We need the first project to feel effortless. Right now, we move between three tools before the team can start.",
    },
    {
        id: "strategy",
        title: "Product strategy",
        detail: "Launch plan · 6 pages",
        kind: "Document",
        quote: "Our launch milestone is a complete first-run experience. Prioritize workspace setup, importing context, and the first useful answer.",
    },
    {
        id: "engineering",
        title: "Engineering",
        detail: "Repository overview",
        kind: "Repository",
        quote: "Workspace creation and document import are ready. The remaining launch work is onboarding copy and the getting-started checklist.",
    },
] as const;
export const SAMPLE_QUESTIONS = [
    {
        question: "What should we focus on?",
        title: "Make the first five minutes count.",
        body: "Customer interviews point to a simpler onboarding experience. The product plan makes it the next milestone, and the engineering notes show the foundations are in place.",
        sources: ["discovery", "strategy", "engineering"],
    },
    {
        question: "What are customers asking for?",
        title: "Less setup. A faster first win.",
        body: "Five of the eight sample interviews mention onboarding friction. Founders want to bring their context together and get a useful answer without switching tools.",
        sources: ["discovery", "strategy"],
    },
    {
        question: "Are we ready to launch?",
        title: "The foundations are ready. Finish the welcome.",
        body: "Workspace creation and imports are in place. The product plan still calls for onboarding copy and a getting-started checklist before release.",
        sources: ["strategy", "engineering"],
    },
    {
        question: "Prepare my founder review.",
        title: "This week: turn customer feedback into a clearer first run.",
        body: "Decision: prioritize onboarding before the public beta. Open question: can a new team reach its first useful answer in five minutes? Next steps: review the interview themes, finish the welcome checklist, and draft the launch story in Notebook.",
        sources: ["discovery", "strategy", "engineering"],
    },
] as const;
export function resolveSampleQuestion(text: string, selected: readonly string[]) {
    const normalized = text
        .trim()
        .toLowerCase()
        .replace(/[?.!]+$/, "");
    const index = SAMPLE_QUESTIONS.findIndex(
        item => item.question.toLowerCase().replace(/[?.!]+$/, "") === normalized
    );
    if (index < 0) return { kind: "unsupported" as const };
    const missing = SAMPLE_QUESTIONS[index]!.sources.filter(id => !selected.includes(id));
    return missing.length
        ? { kind: "missing" as const, missing }
        : { kind: "answer" as const, index };
}
export const SAMPLE_DRAFT =
    "Your next chapter starts with clarity.\n\nWe’re building Acme for founders who want to spend more time on their ideas and less time piecing their context together.\n\nOur public beta brings your documents, decisions, and next steps into one workspace. Join us in making the first five minutes of building feel a little lighter.";
