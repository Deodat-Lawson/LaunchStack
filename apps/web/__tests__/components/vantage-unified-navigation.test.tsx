/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import { VantageTool } from "~/app/employer/tools/vantage/VantageTool";
let mockPath = "/";
let mockSearch = "";
jest.mock("~/components/tool-app/nav", () => ({
    ToolNavProvider: ({ children }: any) => children,
    useToolNav: () => ({
        path: mockPath,
        search: mockSearch,
        searchParams: new URLSearchParams(mockSearch),
        navigate: jest.fn(),
    }),
}));
jest.mock("~/components/tool-app/ToolLink", () => ({
    ToolLink: ({ href, children, ...props }: any) => (
        <a href={href} {...props}>
            {children}
        </a>
    ),
}));
jest.mock("~/components/tool-app/ToolFrame", () => ({
    ToolFrame: ({ groups, children }: any) => (
        <>
            <nav aria-label="Desktop Vantage">
                {groups
                    .flatMap((group: any) => group.items)
                    .map((item: any) => (
                        <a key={item.to} href={item.to}>
                            {item.label}
                        </a>
                    ))}
            </nav>
            {children}
        </>
    ),
    ToolNotFound: () => <p>Not found</p>,
}));
jest.mock("~/app/employer/tools/vantage/_screens/ContextDemoScreen", () => ({
    ContextDemoScreen: () => <p>Primary saved brief</p>,
    ContextNativeReview: ({ week }: any) => <p>Separate saved report {week}</p>,
}));
jest.mock("~/app/employer/tools/vantage/_screens/AgendaScreen", () => ({
    AgendaScreen: () => <p>Existing production review</p>,
}));
jest.mock("~/app/employer/tools/vantage/_screens/CommitmentsScreen", () => ({
    CommitmentsScreen: () => <p>Actual action ledger</p>,
}));
jest.mock("~/app/employer/tools/vantage/_screens/EvidenceScreen", () => ({
    EvidenceScreen: () => <p>Authorized evidence</p>,
}));
jest.mock("~/app/employer/tools/vantage/_screens/MetricsScreen", () => ({
    MetricsScreen: () => <p>Metric observations</p>,
}));
beforeEach(() => {
    mockPath = "/";
    mockSearch = "";
});
it("uses one Weekly Review entry and a single primary report", () => {
    render(<VantageTool contextDemoEnabled />);
    const nav = within(screen.getByRole("navigation", { name: "Desktop Vantage" }));
    expect(nav.getAllByText("Weekly Review")).toHaveLength(1);
    expect(nav.getByText("Actions")).toBeVisible();
    expect(screen.queryByText("Context-Aware Demo")).not.toBeInTheDocument();
    expect(screen.getByText("Primary saved brief")).toBeVisible();
    expect(screen.queryByText(/Separate saved report/)).not.toBeInTheDocument();
});
for (const path of ["/context-demo", "/agenda"])
    it(`preserves ${path} legacy links as the unified primary view`, () => {
        mockPath = path;
        mockSearch = "?week=2026-10-12";
        render(<VantageTool contextDemoEnabled />);
        expect(screen.getByText("Primary saved brief")).toBeVisible();
        expect(screen.queryByText(/Separate saved report/)).not.toBeInTheDocument();
    });
it("opens the alternative report explicitly without mixing topics or losing week on return", () => {
    mockPath = "/agenda";
    mockSearch = "?week=2026-10-12&report=rules";
    render(<VantageTool contextDemoEnabled />);
    expect(screen.getByText("Separate saved report 2026-10-12")).toBeVisible();
    expect(screen.queryByText("Primary saved brief")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Weekly Review" })).toHaveAttribute(
        "href",
        "/?week=2026-10-12"
    );
});
it("retains the existing production view when demo context is disabled", () => {
    render(<VantageTool />);
    expect(screen.getByText("Existing production review")).toBeVisible();
    expect(screen.queryByText("Primary saved brief")).not.toBeInTheDocument();
});
it("keeps the actual action ledger separate from suggestions", () => {
    mockPath = "/commitments";
    render(<VantageTool contextDemoEnabled />);
    expect(screen.getByText("Actual action ledger")).toBeVisible();
    expect(screen.queryByText("Primary saved brief")).not.toBeInTheDocument();
});
