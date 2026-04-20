/** @jest-environment jsdom */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OutlinePanel, type OutlineItem } from "../OutlinePanel";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock fetch (used by generateOutline)
global.fetch = jest.fn();

// Mock ScrollArea to just render children (avoids Radix internals)
jest.mock("~/app/employer/documents/components/ui/scroll-area", () => ({
    ScrollArea: ({ children, ...props }: React.PropsWithChildren) => (
        <div data-testid="scroll-area" {...props}>
            {children}
        </div>
    ),
}));

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

function makeOutline(): OutlineItem[] {
    return [
        {
            id: "1",
            title: "Introduction",
            level: 1,
            children: [
                { id: "1.1", title: "Background", level: 2 },
                {
                    id: "1.2",
                    title: "Motivation",
                    level: 2,
                    children: [
                        { id: "1.2.1", title: "Problem Statement", level: 3 },
                    ],
                },
            ],
        },
        { id: "2", title: "Methods", level: 1 },
    ];
}

const noop = () => {
    /* no-op */
};

function renderPanel(
    outline: OutlineItem[] = [],
    overrides: Partial<React.ComponentProps<typeof OutlinePanel>> = {},
) {
    const defaultProps = {
        outline,
        documentTitle: "Test Document",
        documentDescription: "A test document",
        onOutlineChange: jest.fn(),
        onInsertSection: jest.fn(),
        onClose: jest.fn(),
        ...overrides,
    };
    return { ...render(<OutlinePanel {...defaultProps} />), props: defaultProps };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OutlinePanel", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("renders the empty state when outline is empty", () => {
        renderPanel([]);
        expect(screen.getByText("No outline yet")).toBeInTheDocument();
        expect(
            screen.getByText("Generate one or add sections manually"),
        ).toBeInTheDocument();
    });

    it("renders all visible items when outline has data and items are expanded", async () => {
        // By default, nothing is expanded, so only root items visible
        renderPanel(makeOutline());
        expect(screen.getByText("Introduction")).toBeInTheDocument();
        expect(screen.getByText("Methods")).toBeInTheDocument();
        // Children not visible because not expanded
        expect(screen.queryByText("Background")).not.toBeInTheDocument();
    });

    it("expands and collapses an item when clicking the chevron", async () => {
        const user = userEvent.setup();
        renderPanel(makeOutline());

        // Find the expand button for "Introduction" (the first treeitem with children)
        const introItem = screen.getByText("Introduction").closest('[role="treeitem"]') as HTMLElement;
        const expandBtn = within(introItem).getAllByRole("button")[0]!;

        await user.click(expandBtn);

        // Now children should be visible
        expect(screen.getByText("Background")).toBeInTheDocument();
        expect(screen.getByText("Motivation")).toBeInTheDocument();

        // Collapse
        await user.click(expandBtn);
        expect(screen.queryByText("Background")).not.toBeInTheDocument();
    });

    it("calls onOutlineChange when adding a top-level section", async () => {
        const user = userEvent.setup();
        const { props } = renderPanel(makeOutline());

        const addBtn = screen.getByRole("button", { name: /Add Section/i });
        await user.click(addBtn);

        expect(props.onOutlineChange).toHaveBeenCalledTimes(1);
        const newOutline = (props.onOutlineChange as jest.Mock).mock.calls[0][0] as OutlineItem[];
        expect(newOutline).toHaveLength(3); // 2 original + 1 new
        expect(newOutline[2]!.title).toBe("New Section");
        expect(newOutline[2]!.level).toBe(1);
    });

    it("calls onOutlineChange when deleting an item", async () => {
        const user = userEvent.setup();
        const outline = makeOutline();
        const { props } = renderPanel(outline);

        // Expand "Introduction" first so we can see children
        const introItem = screen.getByText("Introduction").closest('[role="treeitem"]') as HTMLElement;
        const expandBtn = within(introItem).getAllByRole("button")[0]!;
        await user.click(expandBtn);

        // Find and click delete on "Background"
        const bgItem = screen.getByText("Background").closest('[role="treeitem"]') as HTMLElement;
        const deleteBtn = within(bgItem).getByRole("button", { name: /Delete/i });
        await user.click(deleteBtn);

        expect(props.onOutlineChange).toHaveBeenCalled();
    });

    it("renders the ARIA tree structure", () => {
        renderPanel(makeOutline());

        // The tree container should have role="tree"
        const tree = screen.getByRole("tree");
        expect(tree).toBeInTheDocument();

        // Each item should have role="treeitem"
        const treeItems = screen.getAllByRole("treeitem");
        expect(treeItems.length).toBeGreaterThanOrEqual(2); // at least root items
    });

    it("shows the 'Outline' header and Close button", () => {
        renderPanel();
        expect(screen.getByText("Outline")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Close/i })).toBeInTheDocument();
    });

    it("calls onClose when Close button is clicked", async () => {
        const user = userEvent.setup();
        const { props } = renderPanel();
        await user.click(screen.getByRole("button", { name: /Close/i }));
        expect(props.onClose).toHaveBeenCalledTimes(1);
    });

    it("shows the generate controls with topic textarea", () => {
        renderPanel();
        expect(
            screen.getByPlaceholderText("Document topic or description..."),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: /Generate Outline/i }),
        ).toBeInTheDocument();
    });

    it("has the topic textarea pre-filled with the document title", () => {
        renderPanel([], { documentTitle: "My Document" });
        const textarea = screen.getByPlaceholderText(
            "Document topic or description...",
        ) as HTMLTextAreaElement;
        expect(textarea.value).toBe("My Document");
    });
});
